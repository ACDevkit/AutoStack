use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use tauri::Emitter;
use serde::{Deserialize, Serialize};
use portable_pty::{CommandBuilder, native_pty_system, PtySize};

// ─── Shared event type ────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
struct OutputEvent {
    line: String,
    kind: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct DockerRuntimeConfig {
    enabled: bool,
    host_port: u16,
    container_port: u16,
    service_name: String,
    compose_file: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct DockerRuntimePrepared {
    enabled: bool,
    host_port: u16,
    container_port: u16,
    service_name: String,
    compose_file: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
struct ProjectRuntimeSettings {
    runtime_version: String,
    package_manager: String,
    startup_command: String,
    auto_install_deps: bool,
    enable_strict_ports: bool,
}

#[derive(Clone, Debug)]
struct DockerProfile {
    image: String,
    bootstrap_cmd: String,
    run_cmd: String,
    default_port: u16,
}

fn emit_line(app: &tauri::AppHandle, event: &str, kind: &str, line: &str) {
    let _ = app.emit(event, OutputEvent {
        line: line.to_string(),
        kind: kind.to_string(),
    });
}

// ─── Shell helpers (for install commands only) ────────────────────────────────

fn shell_quote(s: &str) -> String {
    if s.contains(' ') {
        format!("\"{}\"", s.replace('"', "\\\""))
    } else {
        s.to_string()
    }
}

/// Build a platform shell command for install/scaffold use.
/// On Windows uses `cmd /C` with CREATE_NO_WINDOW so no console window appears.
fn shell_cmd(cmd_str: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("cmd");
        c.args(["/C", cmd_str]);
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        c
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut c = Command::new("sh");
        c.args(["-c", cmd_str]);
        c
    }
}

/// Spawn a shell command, stream stdout/stderr line-by-line, return Ok on exit 0.
/// Used exclusively for install/scaffold commands where we control the output format.
fn run_command(app: &tauri::AppHandle, event: &str, parts: &[&str], cwd: &Path) -> Result<(), String> {
    let joined = parts.iter().map(|s| shell_quote(s)).collect::<Vec<_>>().join(" ");

    let mut child = shell_cmd(&joined)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("CI", "true")
        .env("npm_config_yes", "true")
        .env("ADBLOCK", "true")
        .env("FORCE_COLOR", "1")
        .env("COLORTERM", "truecolor")
        .env("PYTHONUNBUFFERED", "1")
        .spawn()
        .map_err(|e| format!("Failed to run '{}': {e}", parts.first().unwrap_or(&"")))?;

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    let app1 = app.clone(); let ev1 = event.to_string();
    let t_out = thread::spawn(move || {
        for line in BufReader::new(stdout).lines().flatten() {
            emit_line(&app1, &ev1, "out", &line);
        }
    });
    let app2 = app.clone(); let ev2 = event.to_string();
    let t_err = thread::spawn(move || {
        for line in BufReader::new(stderr).lines().flatten() {
            emit_line(&app2, &ev2, "err", &line);
        }
    });
    let _ = t_out.join();
    let _ = t_err.join();

    let status = child.wait().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("'{}' exited with code {}", parts[0], status.code().unwrap_or(-1)))
    }
}

fn write_file(path: &Path, contents: &str) -> Result<(), String> {
    std::fs::write(path, contents)
        .map_err(|e| format!("Cannot write '{}': {e}", path.display()))
}

/// Convert arbitrary project display names into a safe scaffold directory name.
/// This avoids generator failures caused by uppercase letters, spaces, or symbols.
fn sanitize_project_dir_name(raw: &str) -> String {
    let mut out = String::new();
    let mut last_was_dash = false;

    for ch in raw.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_was_dash = false;
            continue;
        }

        if !last_was_dash {
            out.push('-');
            last_was_dash = true;
        }
    }

    while out.starts_with('-') {
        out.remove(0);
    }
    while out.ends_with('-') {
        out.pop();
    }

    if out.is_empty() {
        "app".to_string()
    } else {
        out
    }
}

fn ensure_unique_dir_name(base: &Path, desired: &str) -> String {
    if !base.join(desired).exists() {
        return desired.to_string();
    }

    let mut n: u32 = 2;
    loop {
        let candidate = format!("{desired}-{n}");
        if !base.join(&candidate).exists() {
            return candidate;
        }
        n += 1;
    }
}

fn command_exists(command: &str) -> bool {
    #[cfg(target_os = "windows")]
    let mut probe = {
        let mut c = Command::new("cmd");
        c.args(["/C", "where", command]);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut probe = {
        let mut c = Command::new("sh");
        c.args(["-c", &format!("command -v {}", command)]);
        c
    };
    probe
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn ensure_docker_available() -> Result<(), String> {
    if !command_exists("docker") {
        return Err(
            "Docker CLI was not found on PATH. Install Docker Desktop (or Docker Engine) and retry."
                .to_string(),
        );
    }
    Ok(())
}

fn ensure_docker_engine_available() -> Result<(), String> {
    ensure_docker_available()?;
    let status = Command::new("docker")
        .args(["info"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("Failed to run Docker CLI: {e}"))?;
    if !status.success() {
        return Err(
            "Docker Engine is not running. Start Docker Desktop (or your Docker service) and try again."
                .to_string(),
        );
    }
    Ok(())
}

fn is_tcp_port_available(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn pick_host_port(preferred: u16) -> Result<u16, String> {
    if preferred > 1024 && is_tcp_port_available(preferred) {
        return Ok(preferred);
    }
    for port in preferred.saturating_add(1)..=u16::MAX {
        if port > 1024 && is_tcp_port_available(port) {
            return Ok(port);
        }
    }
    Err("Unable to find an open local TCP port for port forwarding.".to_string())
}

fn command_output(cmd: &str, args: &[&str]) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    let output = {
        use std::os::windows::process::CommandExt;
        Command::new(cmd)
            .args(args)
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
    };

    #[cfg(not(target_os = "windows"))]
    let output = Command::new(cmd)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();

    let output = output.map_err(|e| format!("Failed to run '{cmd}': {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!(
            "'{cmd} {}' failed: {}",
            args.join(" "),
            stderr.trim()
        ))
    }
}

fn parse_major_version(version_text: &str) -> Option<u32> {
    let mut digits = String::new();
    let mut started = false;
    for ch in version_text.chars() {
        if ch.is_ascii_digit() {
            digits.push(ch);
            started = true;
            continue;
        }
        if started {
            break;
        }
    }
    if digits.is_empty() {
        None
    } else {
        digits.parse::<u32>().ok()
    }
}

fn normalize_package_manager(raw: &str) -> &'static str {
    match raw.trim().to_lowercase().as_str() {
        "pnpm" => "pnpm",
        "yarn" => "yarn",
        "bun" => "bun",
        _ => "npm",
    }
}

fn is_node_ecosystem_framework(framework_id: &str) -> bool {
    matches!(
        framework_id,
        "react"
            | "vite"
            | "vue"
            | "svelte"
            | "solid"
            | "nextjs"
            | "nuxt"
            | "astro"
            | "sveltekit"
            | "remix"
            | "nodejs"
    )
}

fn package_install_command(package_manager: &str) -> &'static str {
    match package_manager {
        "pnpm" => "pnpm install --config.strict-dep-builds=false",
        "yarn" => "yarn install",
        "bun" => "bun install",
        _ => "npm install",
    }
}

fn package_run_script_command(package_manager: &str, script: &str) -> String {
    match package_manager {
        "bun" => format!("bun run {script}"),
        "yarn" => format!("yarn {script}"),
        "pnpm" => format!("pnpm run {script}"),
        _ => format!("npm run {script}"),
    }
}

fn local_package_install_command(package_manager: &str) -> Result<String, String> {
    fn with_relaxed_pnpm_policy(command: &str) -> String {
        #[cfg(target_os = "windows")]
        {
            format!("set PNPM_CONFIG_STRICT_DEP_BUILDS=false&& {command}")
        }
        #[cfg(not(target_os = "windows"))]
        {
            format!("PNPM_CONFIG_STRICT_DEP_BUILDS=false {command}")
        }
    }

    match package_manager {
        "pnpm" => {
            if command_exists("pnpm") {
                Ok(with_relaxed_pnpm_policy(
                    "pnpm install --config.strict-dep-builds=false",
                ))
            } else if command_exists("corepack") {
                Ok(with_relaxed_pnpm_policy(
                    "corepack pnpm install --config.strict-dep-builds=false",
                ))
            } else if command_exists("npx") {
                Ok(with_relaxed_pnpm_policy(
                    "npx --yes pnpm@latest install --config.strict-dep-builds=false",
                ))
            } else {
                Err("Package manager 'pnpm' is selected but pnpm/corepack/npx is not installed.".to_string())
            }
        }
        "yarn" => {
            if command_exists("yarn") {
                Ok("yarn install".to_string())
            } else if command_exists("corepack") {
                Ok("corepack yarn install".to_string())
            } else if command_exists("npx") {
                Ok("npx --yes yarn@1.22.22 install".to_string())
            } else {
                Err("Package manager 'yarn' is selected but yarn/corepack/npx is not installed.".to_string())
            }
        }
        "bun" => {
            if command_exists("bun") {
                Ok("bun install".to_string())
            } else {
                Err("Package manager 'bun' is selected but Bun is not installed.".to_string())
            }
        }
        _ => {
            if command_exists("npm") {
                Ok("npm install".to_string())
            } else {
                Err("Package manager 'npm' is selected but npm is not installed.".to_string())
            }
        }
    }
}

fn local_package_run_script_command(package_manager: &str, script: &str) -> Result<String, String> {
    fn with_relaxed_pnpm_policy(command: &str) -> String {
        #[cfg(target_os = "windows")]
        {
            format!("set PNPM_CONFIG_STRICT_DEP_BUILDS=false&& {command}")
        }
        #[cfg(not(target_os = "windows"))]
        {
            format!("PNPM_CONFIG_STRICT_DEP_BUILDS=false {command}")
        }
    }

    match package_manager {
        "pnpm" => {
            if command_exists("pnpm") {
                Ok(with_relaxed_pnpm_policy(&format!(
                    "pnpm --config.strict-dep-builds=false run {script}"
                )))
            } else if command_exists("corepack") {
                Ok(with_relaxed_pnpm_policy(&format!(
                    "corepack pnpm --config.strict-dep-builds=false run {script}"
                )))
            } else if command_exists("npx") {
                Ok(with_relaxed_pnpm_policy(&format!(
                    "npx --yes pnpm@latest --config.strict-dep-builds=false run {script}"
                )))
            } else {
                Err("Package manager 'pnpm' is selected but pnpm/corepack/npx is not installed.".to_string())
            }
        }
        "yarn" => {
            if command_exists("yarn") {
                Ok(format!("yarn {script}"))
            } else if command_exists("corepack") {
                Ok(format!("corepack yarn {script}"))
            } else if command_exists("npx") {
                Ok(format!("npx --yes yarn@1.22.22 {script}"))
            } else {
                Err("Package manager 'yarn' is selected but yarn/corepack/npx is not installed.".to_string())
            }
        }
        "bun" => {
            if command_exists("bun") {
                Ok(format!("bun run {script}"))
            } else {
                Err("Package manager 'bun' is selected but Bun is not installed.".to_string())
            }
        }
        _ => {
            if command_exists("npm") {
                Ok(format!("npm run {script}"))
            } else {
                Err("Package manager 'npm' is selected but npm is not installed.".to_string())
            }
        }
    }
}

fn ensure_requested_runtime_available(
    framework_id: &str,
    runtime_settings: Option<&ProjectRuntimeSettings>,
    require_scaffold_tools: bool,
) -> Result<(), String> {
    if !is_node_ecosystem_framework(framework_id) {
        return Ok(());
    }

    let runtime_version = runtime_settings
        .map(|cfg| cfg.runtime_version.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or("node-20-lts");
    let package_manager = normalize_package_manager(
        runtime_settings
            .map(|cfg| cfg.package_manager.as_str())
            .unwrap_or("npm"),
    );

    if package_manager == "bun" || runtime_version == "bun-latest" {
        if !command_exists("bun") {
            return Err("Bun runtime is selected but 'bun' was not found on PATH.".to_string());
        }
    }

    if runtime_version != "bun-latest" {
        if !command_exists("node") {
            return Err("Node.js runtime is selected but 'node' was not found on PATH.".to_string());
        }
        let node_version = command_output("node", &["--version"])?;
        let major = parse_major_version(&node_version).ok_or_else(|| {
            format!("Unable to parse installed Node.js version from '{node_version}'.")
        })?;
        let minimum_major = if runtime_version == "node-22-current" { 22 } else { 20 };
        if major < minimum_major {
            return Err(format!(
                "Requested runtime '{}' requires Node {} or newer, but detected {}. Install a newer Node version or change Project Settings.",
                runtime_version, minimum_major, node_version
            ));
        }
    }

    // Resolve package manager up-front so users get immediate, clear failures.
    let _ = local_package_install_command(package_manager)?;
    if require_scaffold_tools && !command_exists("npx") {
        return Err(
            "Project scaffolding requires 'npx', but it was not found on PATH. Install Node.js tooling first."
                .to_string(),
        );
    }
    Ok(())
}

fn run_simple_command_line(
    app: &tauri::AppHandle,
    event: &str,
    command_line: &str,
    cwd: &Path,
) -> Result<(), String> {
    let parts: Vec<&str> = command_line.split_whitespace().collect();
    if parts.is_empty() {
        return Err("Empty command requested.".to_string());
    }
    run_command(app, event, &parts, cwd)
}

fn node_image_for_runtime(runtime_version: &str) -> String {
    match runtime_version {
        "node-22-current" => "node:22-alpine".to_string(),
        "bun-latest" => "oven/bun:1".to_string(),
        _ => "node:20-alpine".to_string(),
    }
}

fn docker_profile_for_framework(
    framework_id: &str,
    runtime_settings: Option<&ProjectRuntimeSettings>,
) -> DockerProfile {
    let runtime_version = runtime_settings
        .map(|cfg| cfg.runtime_version.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("node-20-lts");
    let package_manager = normalize_package_manager(
        runtime_settings
            .map(|cfg| cfg.package_manager.as_str())
            .unwrap_or("npm"),
    );
    let node_image = node_image_for_runtime(runtime_version);
    let node_bootstrap = package_install_command(package_manager).to_string();

    match framework_id {
        "react" => DockerProfile {
            image: node_image,
            bootstrap_cmd: node_bootstrap,
            run_cmd: format!(
                "HOST=0.0.0.0 PORT=${{AUTOSTACK_CONTAINER_PORT}} {}",
                package_run_script_command(package_manager, "start")
            ),
            default_port: 3000,
        },
        "vite" | "vue" | "svelte" | "solid" | "astro" | "sveltekit" | "remix" => DockerProfile {
            image: node_image,
            bootstrap_cmd: node_bootstrap,
            run_cmd: format!(
                "{} -- --host 0.0.0.0 --port ${{AUTOSTACK_CONTAINER_PORT}}",
                package_run_script_command(package_manager, "dev")
            ),
            default_port: 5173,
        },
        "nextjs" | "nuxt" => DockerProfile {
            image: node_image,
            bootstrap_cmd: node_bootstrap,
            run_cmd: format!(
                "{} -- --hostname 0.0.0.0 --port ${{AUTOSTACK_CONTAINER_PORT}}",
                package_run_script_command(package_manager, "dev")
            ),
            default_port: 3000,
        },
        "nodejs" => DockerProfile {
            image: node_image,
            bootstrap_cmd: node_bootstrap,
            run_cmd: "node index.js".to_string(),
            default_port: 3000,
        },
        "fastapi" => DockerProfile {
            image: "python:3.12-slim".to_string(),
            bootstrap_cmd: "pip install -r requirements.txt".to_string(),
            run_cmd: "uvicorn main:app --host 0.0.0.0 --port ${AUTOSTACK_CONTAINER_PORT} --reload"
                .to_string(),
            default_port: 8000,
        },
        "django" => DockerProfile {
            image: "python:3.12-slim".to_string(),
            bootstrap_cmd: "pip install -r requirements.txt".to_string(),
            run_cmd: "python manage.py runserver 0.0.0.0:${AUTOSTACK_CONTAINER_PORT}".to_string(),
            default_port: 8000,
        },
        "go" => DockerProfile {
            image: "golang:1.22-alpine".to_string(),
            bootstrap_cmd: "go mod tidy".to_string(),
            run_cmd: "go run .".to_string(),
            default_port: 8080,
        },
        "rust" => DockerProfile {
            image: "rust:1.78-slim".to_string(),
            bootstrap_cmd: "cargo fetch".to_string(),
            run_cmd: "cargo run".to_string(),
            default_port: 3000,
        },
        "laravel" => DockerProfile {
            image: "php:8.3-cli".to_string(),
            bootstrap_cmd: "if [ -f composer.json ]; then php -r \"copy('https://getcomposer.org/installer', 'composer-setup.php');\" && php composer-setup.php --install-dir=/usr/local/bin --filename=composer && rm composer-setup.php && composer install; fi".to_string(),
            run_cmd: "php artisan serve --host=0.0.0.0 --port=${AUTOSTACK_CONTAINER_PORT}"
                .to_string(),
            default_port: 8000,
        },
        "dotnet" => DockerProfile {
            image: "mcr.microsoft.com/dotnet/sdk:8.0".to_string(),
            bootstrap_cmd: "dotnet restore".to_string(),
            run_cmd: "dotnet run --urls=http://0.0.0.0:${AUTOSTACK_CONTAINER_PORT}".to_string(),
            default_port: 5000,
        },
        _ => DockerProfile {
            image: node_image,
            bootstrap_cmd: node_bootstrap,
            run_cmd: format!(
                "{} -- --host 0.0.0.0 --port ${{AUTOSTACK_CONTAINER_PORT}}",
                package_run_script_command(package_manager, "dev")
            ),
            default_port: 3000,
        },
    }
}

fn shell_single_quote(s: &str) -> String {
    s.replace('\'', "'\\''")
}

fn escape_compose_dollar(s: &str) -> String {
    s.replace('$', "$$")
}

fn sanitize_service_name(project_name: &str) -> String {
    sanitize_project_dir_name(project_name).replace('-', "_")
}

fn write_docker_compose(
    project_path: &Path,
    service_name: &str,
    profile: DockerProfile,
    host_port: u16,
    container_port: u16,
) -> Result<String, String> {
    let compose_file = project_path.join("docker-compose.autostack.yml");
    let bootstrap = shell_single_quote(&profile.bootstrap_cmd);
    let run = shell_single_quote(&escape_compose_dollar(&profile.run_cmd));
    let compose = format!(
        "services:\n  {service}:\n    image: {image}\n    working_dir: /workspace\n    command: sh -lc '{bootstrap} && {run}'\n    environment:\n      AUTOSTACK_CONTAINER_PORT: \"{container_port}\"\n    ports:\n      - \"{host_port}:{container_port}\"\n    volumes:\n      - ./:/workspace\n",
        service = service_name,
        image = profile.image,
        bootstrap = bootstrap,
        run = run,
        host_port = host_port,
        container_port = container_port,
    );
    write_file(&compose_file, &compose)?;
    Ok(compose_file.to_string_lossy().to_string())
}

// ─── Install: per-framework setup functions ────────────────────────────────────

fn setup_vite(
    app: &tauri::AppHandle,
    event: &str,
    base: &Path,
    name: &str,
    template: &str,
    package_manager: &str,
) -> Result<PathBuf, String> {
    emit_line(app, event, "info", &format!("  Creating {template} project with Vite..."));
    run_command(app, event, &["npm", "create", "vite@latest", name, "--", "--template", template], base)?;
    let dir = base.join(name);
    emit_line(app, event, "info", "  Installing dependencies...");
    let install_cmd = local_package_install_command(package_manager)?;
    run_simple_command_line(app, event, &install_cmd, &dir)?;
    Ok(dir)
}

fn setup_react_default(app: &tauri::AppHandle, event: &str, base: &Path, name: &str) -> Result<PathBuf, String> {
    emit_line(app, event, "info", "  Creating default React project...");
    run_command(app, event, &["npx", "--yes", "create-react-app@latest", name], base)?;
    Ok(base.join(name))
}

fn setup_angular(app: &tauri::AppHandle, event: &str, base: &Path, name: &str) -> Result<PathBuf, String> {
    emit_line(app, event, "info", "  Creating Angular project (this may take a while)...");
    run_command(app, event, &["npx", "--yes", "@angular/cli@latest", "new", name, "--defaults", "--skip-git"], base)?;
    Ok(base.join(name))
}

fn setup_nextjs(
    app: &tauri::AppHandle,
    event: &str,
    base: &Path,
    name: &str,
    package_manager: &str,
) -> Result<PathBuf, String> {
    emit_line(app, event, "info", "  Creating Next.js project...");
    let manager_flag = match package_manager {
        "pnpm" => "--use-pnpm",
        "yarn" => "--use-yarn",
        "bun" => "--use-bun",
        _ => "--use-npm",
    };
    run_command(
        app,
        event,
        &[
            "npx",
            "--yes",
            "create-next-app@latest",
            name,
            "--typescript",
            "--eslint",
            "--no-tailwind",
            "--no-app",
            manager_flag,
            "--no-src-dir",
        ],
        base,
    )?;
    Ok(base.join(name))
}

fn setup_nuxt(
    app: &tauri::AppHandle,
    event: &str,
    base: &Path,
    name: &str,
    package_manager: &str,
) -> Result<PathBuf, String> {
    emit_line(app, event, "info", "  Creating Nuxt project...");
    run_command(
        app,
        event,
        &[
            "npx",
            "--yes",
            "nuxi@latest",
            "init",
            name,
            "--packageManager",
            package_manager,
            "--gitInit",
            "false",
        ],
        base,
    )?;
    let dir = base.join(name);
    emit_line(app, event, "info", "  Installing dependencies...");
    let install_cmd = local_package_install_command(package_manager)?;
    run_simple_command_line(app, event, &install_cmd, &dir)?;
    Ok(dir)
}

fn setup_astro(
    app: &tauri::AppHandle,
    event: &str,
    base: &Path,
    name: &str,
    package_manager: &str,
) -> Result<PathBuf, String> {
    emit_line(app, event, "info", "  Creating Astro project...");
    run_command(app, event, &["npm", "create", "astro@latest", name, "--",
        "--template", "minimal", "--no-install", "--no-git", "--yes"], base)?;
    let dir = base.join(name);
    emit_line(app, event, "info", "  Installing dependencies...");
    let install_cmd = local_package_install_command(package_manager)?;
    run_simple_command_line(app, event, &install_cmd, &dir)?;
    Ok(dir)
}

fn setup_sveltekit(
    app: &tauri::AppHandle,
    event: &str,
    base: &Path,
    name: &str,
    package_manager: &str,
) -> Result<PathBuf, String> {
    emit_line(app, event, "info", "  Creating SvelteKit project...");
    run_command(app, event, &["npx", "--yes", "sv", "create", name, "--template", "minimal",
        "--types", "ts", "--no-add-ons"], base)?;
    let dir = base.join(name);
    emit_line(app, event, "info", "  Installing dependencies...");
    let install_cmd = local_package_install_command(package_manager)?;
    run_simple_command_line(app, event, &install_cmd, &dir)?;
    Ok(dir)
}

fn setup_remix(
    app: &tauri::AppHandle,
    event: &str,
    base: &Path,
    name: &str,
    package_manager: &str,
) -> Result<PathBuf, String> {
    emit_line(app, event, "info", "  Creating Remix project...");
    run_command(app, event, &["npx", "--yes", "create-remix@latest", name,
        "--template", "remix", "--no-git-init", "--no-install"], base)?;
    let dir = base.join(name);
    emit_line(app, event, "info", "  Installing dependencies...");
    let install_cmd = local_package_install_command(package_manager)?;
    run_simple_command_line(app, event, &install_cmd, &dir)?;
    Ok(dir)
}

fn setup_nodejs(
    app: &tauri::AppHandle,
    event: &str,
    base: &Path,
    name: &str,
    package_manager: &str,
) -> Result<PathBuf, String> {
    emit_line(app, event, "info", "  Creating Node.js project...");
    let dir = base.join(name);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let init_cmd = match package_manager {
        "pnpm" => {
            if command_exists("pnpm") {
                "pnpm init".to_string()
            } else if command_exists("corepack") {
                "corepack pnpm init".to_string()
            } else {
                "npm init -y".to_string()
            }
        }
        "yarn" => {
            if command_exists("yarn") {
                "yarn init -y".to_string()
            } else if command_exists("corepack") {
                "corepack yarn init -y".to_string()
            } else {
                "npm init -y".to_string()
            }
        }
        "bun" => {
            if command_exists("bun") {
                "bun init -y".to_string()
            } else {
                "npm init -y".to_string()
            }
        }
        _ => "npm init -y".to_string(),
    };
    run_simple_command_line(app, event, &init_cmd, &dir)?;
    write_file(&dir.join("index.js"), concat!(
        "const http = require('http');\n\n",
        "const server = http.createServer((req, res) => {\n",
        "  res.writeHead(200, { 'Content-Type': 'text/plain' });\n",
        "  res.end('Hello, World!\\n');\n",
        "});\n\n",
        "const PORT = process.env.PORT || 3000;\n",
        "server.listen(PORT, () => {\n",
        "  console.log(`Server running at http://localhost:${PORT}`);\n",
        "});\n",
    ))?;
    write_file(&dir.join(".gitignore"), "node_modules/\n.env\n")?;
    emit_line(app, event, "info", "  ✓ Created index.js  —  run with: node index.js");
    Ok(dir)
}

fn setup_fastapi(app: &tauri::AppHandle, event: &str, base: &Path, name: &str) -> Result<PathBuf, String> {
    emit_line(app, event, "info", "  Creating FastAPI project...");
    let dir = base.join(name);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_file(&dir.join("main.py"), concat!(
        "from fastapi import FastAPI\n\napp = FastAPI()\n\n\n",
        "@app.get(\"/\")\ndef read_root():\n    return {\"Hello\": \"World\"}\n\n\n",
        "@app.get(\"/items/{item_id}\")\n",
        "def read_item(item_id: int, q: str | None = None):\n",
        "    return {\"item_id\": item_id, \"q\": q}\n",
    ))?;
    write_file(&dir.join("requirements.txt"), "fastapi>=0.110.0\nuvicorn[standard]>=0.27.0\n")?;
    write_file(&dir.join(".gitignore"), "__pycache__/\n*.pyc\nvenv/\n.env\n")?;
    emit_line(app, event, "info", "  Installing Python dependencies...");
    if run_command(app, event, &["pip3", "install", "-r", "requirements.txt"], &dir).is_err() {
        run_command(app, event, &["pip", "install", "-r", "requirements.txt"], &dir)?;
    }
    emit_line(app, event, "info", "  ✓ Run with: uvicorn main:app --reload");
    Ok(dir)
}

fn setup_django(app: &tauri::AppHandle, event: &str, base: &Path, name: &str) -> Result<PathBuf, String> {
    emit_line(app, event, "info", "  Installing Django...");
    if run_command(app, event, &["pip3", "install", "django"], base).is_err() {
        run_command(app, event, &["pip", "install", "django"], base)?;
    }
    emit_line(app, event, "info", "  Creating Django project...");
    run_command(app, event, &["django-admin", "startproject", name], base)?;
    let dir = base.join(name);
    write_file(&dir.join("requirements.txt"), "Django>=5.0\n")?;
    emit_line(app, event, "info", "  ✓ Run with: python manage.py runserver");
    Ok(dir)
}

fn setup_go(app: &tauri::AppHandle, event: &str, base: &Path, name: &str) -> Result<PathBuf, String> {
    emit_line(app, event, "info", "  Creating Go project...");
    let dir = base.join(name);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let module = name.to_lowercase().replace(' ', "-");
    run_command(app, event, &["go", "mod", "init", &module], &dir)?;
    write_file(&dir.join("main.go"), concat!(
        "package main\n\nimport (\n\t\"fmt\"\n\t\"net/http\"\n)\n\n",
        "func main() {\n",
        "\thttp.HandleFunc(\"/\", func(w http.ResponseWriter, r *http.Request) {\n",
        "\t\tfmt.Fprintln(w, \"Hello, World!\")\n\t})\n",
        "\tfmt.Println(\"Server running at http://localhost:8080\")\n",
        "\tif err := http.ListenAndServe(\":8080\", nil); err != nil {\n\t\tpanic(err)\n\t}\n}\n",
    ))?;
    write_file(&dir.join(".gitignore"), "*.exe\n*.exe~\n*.dll\n*.so\n*.dylib\n*.test\n*.out\nvendor/\n")?;
    emit_line(app, event, "info", "  ✓ Run with: go run main.go");
    Ok(dir)
}

fn setup_rust_axum(app: &tauri::AppHandle, event: &str, base: &Path, name: &str) -> Result<PathBuf, String> {
    emit_line(app, event, "info", "  Creating Rust/Axum project...");
    let safe_name = name.to_lowercase().replace(' ', "-");
    run_command(app, event, &["cargo", "new", &safe_name, "--vcs", "none"], base)?;
    let dir = base.join(&safe_name);
    emit_line(app, event, "info", "  Adding Axum and Tokio dependencies...");
    run_command(app, event, &["cargo", "add", "axum"], &dir)?;
    run_command(app, event, &["cargo", "add", "tokio", "--features", "full"], &dir)?;
    write_file(&dir.join("src").join("main.rs"), concat!(
        "use axum::{routing::get, Router};\n\n",
        "#[tokio::main]\nasync fn main() {\n",
        "    let app = Router::new().route(\"/\", get(root));\n",
        "    let listener = tokio::net::TcpListener::bind(\"0.0.0.0:3000\").await.unwrap();\n",
        "    println!(\"Listening on http://0.0.0.0:3000\");\n",
        "    axum::serve(listener, app).await.unwrap();\n}\n\n",
        "async fn root() -> &'static str { \"Hello, World!\" }\n",
    ))?;
    emit_line(app, event, "info", "  ✓ Run with: cargo run");
    Ok(dir)
}

fn setup_laravel(app: &tauri::AppHandle, event: &str, base: &Path, name: &str) -> Result<PathBuf, String> {
    emit_line(app, event, "info", "  Creating Laravel project (requires Composer)...");
    run_command(app, event, &["composer", "create-project", "laravel/laravel", name], base)?;
    Ok(base.join(name))
}

fn setup_dotnet(app: &tauri::AppHandle, event: &str, base: &Path, name: &str) -> Result<PathBuf, String> {
    emit_line(app, event, "info", "  Creating .NET Web API project...");
    let safe_name = name.replace(' ', ".");
    run_command(app, event, &["dotnet", "new", "webapi", "-n", &safe_name, "-o", name], base)?;
    emit_line(app, event, "info", "  ✓ Run with: dotnet run");
    Ok(base.join(name))
}

// ─── Install: core logic ───────────────────────────────────────────────────────

fn do_install(
    app: tauri::AppHandle,
    project_id: String,
    framework_id: String,
    project_name: String,
    install_path: String,
    runtime_settings: Option<ProjectRuntimeSettings>,
) -> Result<String, String> {
    let event = format!("install_output_{}", project_id);

    let base: PathBuf = if install_path.trim().is_empty() {
        #[cfg(target_os = "windows")]
        let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Public".to_string());
        #[cfg(not(target_os = "windows"))]
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        PathBuf::from(home).join("AutoStack")
    } else {
        PathBuf::from(install_path.trim())
    };

    if !base.exists() {
        std::fs::create_dir_all(&base)
            .map_err(|e| format!("Cannot create directory '{}': {e}", base.display()))?;
    }

    emit_line(&app, &event, "info", &format!(
        "  Setting up '{}' ({}) in {}", project_name, framework_id, base.display()
    ));
    emit_line(&app, &event, "info", "");

    // Scaffold tools can reject names with uppercase or special chars. Always
    // normalize once and use the safe directory name for generators.
    let sanitized_name = sanitize_project_dir_name(&project_name);
    if sanitized_name != project_name {
        emit_line(
            &app,
            &event,
            "info",
            &format!("  Using safe project directory name: {}", sanitized_name),
        );
        emit_line(&app, &event, "info", "");
    }
    let safe_project_name = ensure_unique_dir_name(&base, &sanitized_name);
    if safe_project_name != sanitized_name {
        emit_line(
            &app,
            &event,
            "info",
            &format!("  Directory already exists, using: {}", safe_project_name),
        );
        emit_line(&app, &event, "info", "");
    }

    let package_manager = normalize_package_manager(
        runtime_settings
            .as_ref()
            .map(|cfg| cfg.package_manager.as_str())
            .unwrap_or("npm"),
    );
    ensure_requested_runtime_available(&framework_id, runtime_settings.as_ref(), true)?;

    let project_dir = match framework_id.as_str() {
        "react"     => setup_react_default(&app, &event, &base, &safe_project_name)?,
        "vite"      => setup_vite(&app, &event, &base, &safe_project_name, "react-ts", package_manager)?,
        "nextjs"    => setup_nextjs(&app, &event, &base, &safe_project_name, package_manager)?,
        "astro"     => setup_astro(&app, &event, &base, &safe_project_name, package_manager)?,
        "remix"     => setup_remix(&app, &event, &base, &safe_project_name, package_manager)?,
        "angular"   => setup_angular(&app, &event, &base, &safe_project_name)?,
        "vue"       => setup_vite(&app, &event, &base, &safe_project_name, "vue-ts", package_manager)?,
        "svelte"    => setup_vite(&app, &event, &base, &safe_project_name, "svelte-ts", package_manager)?,
        "solid"     => setup_vite(&app, &event, &base, &safe_project_name, "solid-ts", package_manager)?,
        "nuxt"      => setup_nuxt(&app, &event, &base, &safe_project_name, package_manager)?,
        "sveltekit" => setup_sveltekit(&app, &event, &base, &safe_project_name, package_manager)?,
        "nodejs"    => setup_nodejs(&app, &event, &base, &safe_project_name, package_manager)?,
        "fastapi"   => setup_fastapi(&app, &event, &base, &safe_project_name)?,
        "django"    => setup_django(&app, &event, &base, &safe_project_name)?,
        "go"        => setup_go(&app, &event, &base, &safe_project_name)?,
        "rust"      => setup_rust_axum(&app, &event, &base, &safe_project_name)?,
        "laravel"   => setup_laravel(&app, &event, &base, &safe_project_name)?,
        "dotnet"    => setup_dotnet(&app, &event, &base, &safe_project_name)?,
        other       => return Err(format!("Unknown framework: {}", other)),
    };

    let dir_str = project_dir.to_string_lossy().to_string();
    emit_line(&app, &event, "success", "");
    emit_line(&app, &event, "success", &format!("  ✓ Project ready  →  {}", dir_str));
    Ok(dir_str)
}

#[tauri::command]
async fn install_project(
    app: tauri::AppHandle,
    project_id: String,
    framework_id: String,
    project_name: String,
    install_path: String,
    runtime_settings: Option<ProjectRuntimeSettings>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        do_install(
            app,
            project_id,
            framework_id,
            project_name,
            install_path,
            runtime_settings,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn prepare_docker_runtime(
    project_path: String,
    framework_id: String,
    project_name: String,
    runtime_settings: Option<ProjectRuntimeSettings>,
    preferred_host_port: Option<u16>,
) -> Result<DockerRuntimePrepared, String> {
    ensure_docker_available()?;
    let project_dir = PathBuf::from(project_path.trim());
    if !project_dir.exists() {
        return Err("Project path does not exist yet. Install/create the project first.".to_string());
    }

    let profile = docker_profile_for_framework(&framework_id, runtime_settings.as_ref());
    let container_port = profile.default_port;
    let preferred = preferred_host_port.unwrap_or(container_port);
    let host_port = pick_host_port(preferred)?;
    let service_name = sanitize_service_name(&project_name);
    let compose_file = write_docker_compose(
        &project_dir,
        &service_name,
        profile,
        host_port,
        container_port,
    )?;

    Ok(DockerRuntimePrepared {
        enabled: true,
        host_port,
        container_port,
        service_name,
        compose_file,
    })
}

// ─── PTY session management ───────────────────────────────────────────────────

/// Messages sent to the master-owning thread.
enum MasterMsg {
    Resize(PtySize),
    Shutdown,
}

/// SAFETY: All concrete MasterPty implementations in portable-pty (UnixMasterPty,
/// ConPtyMaster) are Send, but the trait itself does not advertise this.
struct SendMaster(Box<dyn portable_pty::MasterPty>);
unsafe impl Send for SendMaster {}

struct PtySessionData {
    /// Write end of the PTY master — forwards bytes to the shell's stdin.
    writer: Box<dyn std::io::Write + Send>,
    /// Channel to the master-owning thread (resize or shutdown).
    master_tx: mpsc::SyncSender<MasterMsg>,
}

/// Global map: project_id → active PTY session.
pub struct PtySessions(Arc<Mutex<HashMap<String, PtySessionData>>>);

fn default_port_for_framework(framework_id: &str) -> u16 {
    match framework_id {
        "react" | "nextjs" | "nuxt" | "nodejs" | "rust" => 3000,
        "vite" | "vue" | "svelte" | "solid" | "astro" | "sveltekit" | "remix" => 5173,
        "fastapi" | "django" | "laravel" => 8000,
        "go" => 8080,
        "dotnet" => 5000,
        _ => 3000,
    }
}

fn get_default_start_command(framework_id: &str, package_manager: &str) -> Result<String, String> {
    match framework_id {
        "react" | "angular" => local_package_run_script_command(package_manager, "start"),
        "vite" | "vue" | "svelte" | "solid" | "nextjs" | "nuxt" | "astro" | "sveltekit" | "remix" => {
            local_package_run_script_command(package_manager, "dev")
        }
        "nodejs" => Ok("node index.js".to_string()),
        "fastapi" => Ok("uvicorn main:app --reload".to_string()),
        "django" => Ok("python manage.py runserver".to_string()),
        "go" => Ok("go run .".to_string()),
        "rust" => Ok("cargo run".to_string()),
        "laravel" => Ok("php artisan serve".to_string()),
        "dotnet" => Ok("dotnet run".to_string()),
        _ => local_package_run_script_command(package_manager, "start"),
    }
}

fn resolve_custom_start_command(command: &str) -> Result<String, String> {
    fn with_relaxed_pnpm_policy(command: &str) -> String {
        #[cfg(target_os = "windows")]
        {
            format!("set PNPM_CONFIG_STRICT_DEP_BUILDS=false&& {command}")
        }
        #[cfg(not(target_os = "windows"))]
        {
            format!("PNPM_CONFIG_STRICT_DEP_BUILDS=false {command}")
        }
    }

    let trimmed = command.trim();
    let mut parts = trimmed.split_whitespace();
    let Some(bin) = parts.next() else {
        return Err("Startup command is empty.".to_string());
    };
    let rest = parts.collect::<Vec<_>>().join(" ");
    match bin.to_lowercase().as_str() {
        "pnpm" => {
            if command_exists("pnpm") {
                Ok(with_relaxed_pnpm_policy(
                    format!("pnpm --config.strict-dep-builds=false {rest}").trim(),
                ))
            } else if command_exists("corepack") {
                Ok(
                    with_relaxed_pnpm_policy(
                        format!("corepack pnpm --config.strict-dep-builds=false {rest}").trim(),
                    ),
                )
            } else if command_exists("npx") {
                Ok(
                    with_relaxed_pnpm_policy(
                        format!("npx --yes pnpm@latest --config.strict-dep-builds=false {rest}").trim(),
                    ),
                )
            } else {
                Err("Startup command uses 'pnpm' but pnpm/corepack/npx is not installed.".to_string())
            }
        }
        "corepack" => {
            let mut rest_parts = rest.split_whitespace();
            if let Some(tool) = rest_parts.next() {
                if tool.eq_ignore_ascii_case("pnpm") {
                    let remaining = rest_parts.collect::<Vec<_>>().join(" ");
                    if command_exists("corepack") {
                        return Ok(
                            with_relaxed_pnpm_policy(
                                format!("corepack pnpm --config.strict-dep-builds=false {remaining}")
                                    .trim(),
                            ),
                        );
                    }
                }
            }
            Ok(trimmed.to_string())
        }
        "yarn" => {
            if command_exists("yarn") {
                Ok(trimmed.to_string())
            } else if command_exists("corepack") {
                Ok(format!("corepack yarn {rest}").trim().to_string())
            } else if command_exists("npx") {
                Ok(format!("npx --yes yarn@1.22.22 {rest}").trim().to_string())
            } else {
                Err("Startup command uses 'yarn' but yarn/corepack/npx is not installed.".to_string())
            }
        }
        "bun" => {
            if command_exists("bun") {
                Ok(trimmed.to_string())
            } else {
                Err("Startup command uses 'bun' but Bun is not installed.".to_string())
            }
        }
        _ => Ok(trimmed.to_string()),
    }
}

fn with_strict_port_flags(base_command: String, framework_id: &str) -> String {
    let port = default_port_for_framework(framework_id);
    match framework_id {
        "vite" | "vue" | "svelte" | "solid" | "astro" | "sveltekit" | "remix" => {
            format!("{base_command} -- --host 127.0.0.1 --port {port} --strictPort")
        }
        "nextjs" | "nuxt" => {
            format!("{base_command} -- --hostname 127.0.0.1 --port {port}")
        }
        _ => base_command,
    }
}

fn get_start_command(
    framework_id: &str,
    runtime_settings: Option<&ProjectRuntimeSettings>,
) -> Result<String, String> {
    let package_manager = normalize_package_manager(
        runtime_settings
            .map(|cfg| cfg.package_manager.as_str())
            .unwrap_or("npm"),
    );
    let mut cmd = if let Some(settings) = runtime_settings {
        let custom = settings.startup_command.trim();
        if !custom.is_empty() {
            resolve_custom_start_command(custom)?
        } else {
            get_default_start_command(framework_id, package_manager)?
        }
    } else {
        get_default_start_command(framework_id, package_manager)?
    };
    if let Some(settings) = runtime_settings {
        if settings.enable_strict_ports {
            cmd = with_strict_port_flags(cmd, framework_id);
        }
    }
    Ok(cmd)
}

fn should_auto_install_deps(
    project_path: &str,
    framework_id: &str,
    runtime_settings: Option<&ProjectRuntimeSettings>,
) -> bool {
    let Some(settings) = runtime_settings else {
        return false;
    };
    if !settings.auto_install_deps || !is_node_ecosystem_framework(framework_id) {
        return false;
    }
    let project_dir = PathBuf::from(project_path);
    let package_json = project_dir.join("package.json");
    let node_modules = project_dir.join("node_modules");
    let package_manager = normalize_package_manager(settings.package_manager.as_str());
    let selected_lock_present = match package_manager {
        "pnpm" => project_dir.join("pnpm-lock.yaml").exists(),
        "yarn" => project_dir.join("yarn.lock").exists(),
        "bun" => project_dir.join("bun.lock").exists() || project_dir.join("bun.lockb").exists(),
        _ => project_dir.join("package-lock.json").exists(),
    };
    let other_lock_present = project_dir.join("package-lock.json").exists()
        || project_dir.join("pnpm-lock.yaml").exists()
        || project_dir.join("yarn.lock").exists()
        || project_dir.join("bun.lock").exists()
        || project_dir.join("bun.lockb").exists();
    // If another package manager already initialized the project, don't force an
    // auto-install with a different manager on start. Let user run manually.
    if !selected_lock_present && other_lock_present {
        return false;
    }
    package_json.exists() && !node_modules.exists()
}

fn build_shell_input_for_command(project_path: &str, command: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        format!(
            "cd /d \"{}\"\r\n{}\r\n",
            project_path.replace('"', "\"\""),
            command,
        )
    }
    #[cfg(not(target_os = "windows"))]
    {
        format!(
            "cd '{}' && {}\n",
            project_path.replace('\'', "'\\''"),
            command,
        )
    }
}

// ─── PTY commands ─────────────────────────────────────────────────────────────

/// Open a PTY shell for a project.  Idempotent: if a session already exists
/// for this project_id the call resizes it and returns immediately.
///
/// Architecture:
///   - A master-owning thread holds the PTY master and the child handle.
///     It processes resize / shutdown messages from a channel.
///   - A reader thread streams raw output chunks as `shell_output_{id}` events.
///     When the shell exits it emits `shell_exit_{id}` and auto-removes the
///     session from the map so a subsequent `open_shell` creates a new one.
#[tauri::command]
fn open_shell(
    app: tauri::AppHandle,
    state: tauri::State<'_, PtySessions>,
    project_id: String,
    project_path: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let cols = cols.max(20);
    let rows = rows.max(5);

    // Idempotent: if session already exists just resize it.
    {
        let map = state.0.lock().unwrap();
        if let Some(session) = map.get(&project_id) {
            let _ = session.master_tx.send(MasterMsg::Resize(PtySize {
                rows, cols, pixel_width: 0, pixel_height: 0,
            }));
            return Ok(());
        }
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    // Build the shell command.
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = CommandBuilder::new("cmd.exe");
        c.arg("/K"); // keep-alive mode
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        CommandBuilder::new(shell)
    };

    if !project_path.trim().is_empty() && Path::new(&project_path).exists() {
        cmd.cwd(&project_path);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("FORCE_COLOR", "1");
    cmd.env("PYTHONUNBUFFERED", "1");

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    // Drop the slave side after spawning — the child owns it now.
    drop(pair.slave);

    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let (master_tx, master_rx) = mpsc::sync_channel::<MasterMsg>(32);
    // Clone sender for the reader thread so it can signal shutdown on exit.
    let master_tx_for_reader = master_tx.clone();

    // ── Master-owning thread ────────────────────────────────────────────────
    // Owns the PTY master (not Send by trait, hence SendMaster wrapper) and
    // the child handle.  Processes resize / shutdown messages.
    let master_wrapper = SendMaster(pair.master);
    let mut child_handle = child;
    thread::spawn(move || {
        while let Ok(msg) = master_rx.recv() {
            match msg {
                MasterMsg::Resize(size) => {
                    let _ = master_wrapper.0.resize(size);
                }
                MasterMsg::Shutdown => break,
            }
        }
        // Kill the child and close the PTY.
        let _ = child_handle.kill();
        drop(master_wrapper);
    });

    // ── Reader / streaming thread ───────────────────────────────────────────
    // Reads raw PTY output in chunks and emits them as `shell_output_{id}`.
    // On EOF (shell exit), emits `shell_exit_{id}` and cleans up.
    let out_event  = format!("shell_output_{}", project_id);
    let exit_event = format!("shell_exit_{}", project_id);
    let sessions_arc = state.0.clone();
    let pid_clone    = project_id.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut reader = reader;
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app.emit(&out_event, OutputEvent { line: chunk, kind: "raw".to_string() });
                }
            }
        }
        // Shell has exited: clean up the session so open_shell can create a new one.
        sessions_arc.lock().unwrap().remove(&pid_clone);
        let _ = master_tx_for_reader.send(MasterMsg::Shutdown);
        let _ = app.emit(&exit_event, ());
    });

    state.0.lock().unwrap().insert(project_id, PtySessionData { writer, master_tx });
    Ok(())
}

/// Close the PTY shell for a project (kills the shell process).
#[tauri::command]
fn close_shell(
    state: tauri::State<'_, PtySessions>,
    project_id: String,
) -> Result<(), String> {
    let mut map = state.0.lock().unwrap();
    if let Some(session) = map.remove(&project_id) {
        let _ = session.master_tx.send(MasterMsg::Shutdown);
        // writer drops here, closing the write end of the PTY.
    }
    Ok(())
}

/// Forward keyboard data from xterm.js to the shell's PTY master.
/// This is the primary input path: every character the user types in the
/// embedded terminal is sent here verbatim (including Ctrl+C = "\x03", etc.).
#[tauri::command]
fn write_shell_input(
    state: tauri::State<'_, PtySessions>,
    project_id: String,
    data: String,
) -> Result<(), String> {
    use std::io::Write;
    let mut map = state.0.lock().unwrap();
    if let Some(session) = map.get_mut(&project_id) {
        session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Notify the PTY of the terminal's new size after a resize event.
/// Without this, line-wrapping and cursor positioning break.
#[tauri::command]
fn resize_shell(
    state: tauri::State<'_, PtySessions>,
    project_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let map = state.0.lock().unwrap();
    if let Some(session) = map.get(&project_id) {
        let _ = session.master_tx.send(MasterMsg::Resize(PtySize {
            rows: rows.max(5),
            cols: cols.max(20),
            pixel_width:  0,
            pixel_height: 0,
        }));
    }
    Ok(())
}

// ─── Dev server lifecycle (via PTY shell) ─────────────────────────────────────

/// Start the dev server by writing the appropriate command to the project's
/// PTY shell.  The shell navigates to the project directory first so the
/// command runs in the correct context regardless of where the shell started.
///
/// Output reaches the frontend through the existing `shell_output_{id}` stream
/// — no separate process or event channel is needed.
#[tauri::command]
fn start_project(
    state: tauri::State<'_, PtySessions>,
    project_id: String,
    framework_id: String,
    project_path: String,
    runtime_settings: Option<ProjectRuntimeSettings>,
    docker_config: Option<DockerRuntimeConfig>,
) -> Result<(), String> {
    use std::io::Write;

    if docker_config.as_ref().map(|cfg| !cfg.enabled).unwrap_or(true) {
        ensure_requested_runtime_available(&framework_id, runtime_settings.as_ref(), false)?;
    }

    let shell_input = if let Some(cfg) = docker_config {
        if cfg.enabled {
            ensure_docker_engine_available()?;
            let compose_path = cfg.compose_file.replace('"', "\"\"");
            let docker_cmd = format!(
                "docker compose -f \"{}\" up --build --remove-orphans",
                compose_path,
            );
            build_shell_input_for_command(&project_path, &docker_cmd)
        } else {
            let mut cmd = get_start_command(&framework_id, runtime_settings.as_ref())?;
            if should_auto_install_deps(&project_path, &framework_id, runtime_settings.as_ref()) {
                let pm = normalize_package_manager(
                    runtime_settings
                        .as_ref()
                        .map(|cfg| cfg.package_manager.as_str())
                        .unwrap_or("npm"),
                );
                cmd = format!("{} && {}", local_package_install_command(pm)?, cmd);
            }
            build_shell_input_for_command(&project_path, &cmd)
        }
    } else {
        let mut cmd = get_start_command(&framework_id, runtime_settings.as_ref())?;
        if should_auto_install_deps(&project_path, &framework_id, runtime_settings.as_ref()) {
            let pm = normalize_package_manager(
                runtime_settings
                    .as_ref()
                    .map(|cfg| cfg.package_manager.as_str())
                    .unwrap_or("npm"),
            );
            cmd = format!("{} && {}", local_package_install_command(pm)?, cmd);
        }
        build_shell_input_for_command(&project_path, &cmd)
    };

    let mut map = state.0.lock().unwrap();
    match map.get_mut(&project_id) {
        Some(session) => {
            session.writer.write_all(shell_input.as_bytes()).map_err(|e| e.to_string())?;
            session.writer.flush().map_err(|e| e.to_string())?;
            Ok(())
        }
        None => Err(
            "No shell session for this project. Open the project tab before starting.".to_string()
        ),
    }
}

/// Stop the dev server by sending Ctrl+C to the PTY.
/// The PTY delivers SIGINT to the foreground process group exactly as if the
/// user pressed Ctrl+C in a real terminal — this works for all frameworks.
#[tauri::command]
fn stop_project(
    state: tauri::State<'_, PtySessions>,
    project_id: String,
    project_path: Option<String>,
    docker_config: Option<DockerRuntimeConfig>,
) -> Result<(), String> {
    use std::io::Write;
    let mut map = state.0.lock().unwrap();
    if let Some(session) = map.get_mut(&project_id) {
        // \x03 = ETX = Ctrl+C
        session.writer.write_all(b"\x03").map_err(|e| e.to_string())?;
        if let (Some(path), Some(cfg)) = (project_path, docker_config) {
            if cfg.enabled {
                if ensure_docker_available().is_ok() {
                    let down_cmd = format!(
                        "docker compose -f \"{}\" down --remove-orphans",
                        cfg.compose_file.replace('"', "\"\""),
                    );
                    let down_input = build_shell_input_for_command(&path, &down_cmd);
                    session
                        .writer
                        .write_all(down_input.as_bytes())
                        .map_err(|e| e.to_string())?;
                }
            }
        }
        session.writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ─── Misc ──────────────────────────────────────────────────────────────────────

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Open a directory in the system file explorer (Explorer / Finder / xdg-open).
#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        Command::new("explorer")
            .arg(&path)
            .creation_flags(0x0800_0000)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

// ─── App entry ────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PtySessions(Arc::new(Mutex::new(HashMap::new()))))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            install_project,
            prepare_docker_runtime,
            start_project,
            stop_project,
            open_folder,
            open_shell,
            close_shell,
            write_shell_input,
            resize_shell,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
