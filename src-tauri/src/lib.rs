use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::Emitter;
use serde::Serialize;

// ─── Shared types ─────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
struct OutputEvent {
    line: String,
    kind: String,
}

fn emit_line(app: &tauri::AppHandle, event: &str, kind: &str, line: &str) {
    let _ = app.emit(event, OutputEvent {
        line: line.to_string(),
        kind: kind.to_string(),
    });
}

// ─── Shell helpers ─────────────────────────────────────────────────────────────

fn shell_quote(s: &str) -> String {
    if s.contains(' ') {
        format!("\"{}\"", s.replace('"', "\\\""))
    } else {
        s.to_string()
    }
}

/// Spawn a shell command, stream stdout/stderr as events, return Ok on exit 0.
fn run_command(app: &tauri::AppHandle, event: &str, parts: &[&str], cwd: &Path) -> Result<(), String> {
    let joined = parts.iter().map(|s| shell_quote(s)).collect::<Vec<_>>().join(" ");

    #[cfg(target_os = "windows")]
    let mut child = Command::new("cmd")
        .args(["/C", &joined])
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("CI", "true")
        .env("npm_config_yes", "true")
        .env("ADBLOCK", "true")
        .spawn()
        .map_err(|e| format!("Failed to run '{}': {e}", parts.first().unwrap_or(&"")))?;

    #[cfg(not(target_os = "windows"))]
    let mut child = Command::new("sh")
        .args(["-c", &joined])
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("CI", "true")
        .env("npm_config_yes", "true")
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

// ─── Install: per-framework setup functions ────────────────────────────────────

fn setup_vite(app: &tauri::AppHandle, event: &str, base: &Path, name: &str, template: &str) -> Result<PathBuf, String> {
    emit_line(app, event, "info", &format!("  Creating {template} project with Vite..."));
    run_command(app, event, &["npm", "create", "vite@latest", name, "--", "--template", template], base)?;
    let dir = base.join(name);
    emit_line(app, event, "info", "  Installing dependencies...");
    run_command(app, event, &["npm", "install"], &dir)?;
    Ok(dir)
}

fn setup_angular(app: &tauri::AppHandle, event: &str, base: &Path, name: &str) -> Result<PathBuf, String> {
    emit_line(app, event, "info", "  Creating Angular project (this may take a while)...");
    run_command(app, event, &["npx", "--yes", "@angular/cli@latest", "new", name, "--defaults", "--skip-git"], base)?;
    Ok(base.join(name))
}

fn setup_nextjs(app: &tauri::AppHandle, event: &str, base: &Path, name: &str) -> Result<PathBuf, String> {
    emit_line(app, event, "info", "  Creating Next.js project...");
    run_command(app, event, &["npx", "--yes", "create-next-app@latest", name,
        "--typescript", "--eslint", "--no-tailwind", "--no-app", "--use-npm", "--no-src-dir"], base)?;
    Ok(base.join(name))
}

fn setup_nuxt(app: &tauri::AppHandle, event: &str, base: &Path, name: &str) -> Result<PathBuf, String> {
    emit_line(app, event, "info", "  Creating Nuxt project...");
    run_command(app, event, &["npx", "--yes", "nuxi@latest", "init", name, "--packageManager", "npm", "--gitInit", "false"], base)?;
    let dir = base.join(name);
    emit_line(app, event, "info", "  Installing dependencies...");
    run_command(app, event, &["npm", "install"], &dir)?;
    Ok(dir)
}

fn setup_astro(app: &tauri::AppHandle, event: &str, base: &Path, name: &str) -> Result<PathBuf, String> {
    emit_line(app, event, "info", "  Creating Astro project...");
    run_command(app, event, &["npm", "create", "astro@latest", name, "--",
        "--template", "minimal", "--no-install", "--no-git", "--yes"], base)?;
    let dir = base.join(name);
    emit_line(app, event, "info", "  Installing dependencies...");
    run_command(app, event, &["npm", "install"], &dir)?;
    Ok(dir)
}

fn setup_sveltekit(app: &tauri::AppHandle, event: &str, base: &Path, name: &str) -> Result<PathBuf, String> {
    emit_line(app, event, "info", "  Creating SvelteKit project...");
    run_command(app, event, &["npx", "--yes", "sv", "create", name, "--template", "minimal",
        "--types", "ts", "--no-add-ons"], base)?;
    let dir = base.join(name);
    emit_line(app, event, "info", "  Installing dependencies...");
    run_command(app, event, &["npm", "install"], &dir)?;
    Ok(dir)
}

fn setup_remix(app: &tauri::AppHandle, event: &str, base: &Path, name: &str) -> Result<PathBuf, String> {
    emit_line(app, event, "info", "  Creating Remix project...");
    run_command(app, event, &["npx", "--yes", "create-remix@latest", name,
        "--template", "remix", "--no-git-init", "--no-install"], base)?;
    let dir = base.join(name);
    emit_line(app, event, "info", "  Installing dependencies...");
    run_command(app, event, &["npm", "install"], &dir)?;
    Ok(dir)
}

fn setup_nodejs(app: &tauri::AppHandle, event: &str, base: &Path, name: &str) -> Result<PathBuf, String> {
    emit_line(app, event, "info", "  Creating Node.js project...");
    let dir = base.join(name);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    run_command(app, event, &["npm", "init", "-y"], &dir)?;
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

    let project_dir = match framework_id.as_str() {
        "react"     => setup_vite(&app, &event, &base, &project_name, "react-ts")?,
        "vue"       => setup_vite(&app, &event, &base, &project_name, "vue-ts")?,
        "svelte"    => setup_vite(&app, &event, &base, &project_name, "svelte-ts")?,
        "solid"     => setup_vite(&app, &event, &base, &project_name, "solid-ts")?,
        "angular"   => setup_angular(&app, &event, &base, &project_name)?,
        "nextjs"    => setup_nextjs(&app, &event, &base, &project_name)?,
        "nuxt"      => setup_nuxt(&app, &event, &base, &project_name)?,
        "astro"     => setup_astro(&app, &event, &base, &project_name)?,
        "sveltekit" => setup_sveltekit(&app, &event, &base, &project_name)?,
        "remix"     => setup_remix(&app, &event, &base, &project_name)?,
        "nodejs"    => setup_nodejs(&app, &event, &base, &project_name)?,
        "fastapi"   => setup_fastapi(&app, &event, &base, &project_name)?,
        "django"    => setup_django(&app, &event, &base, &project_name)?,
        "go"        => setup_go(&app, &event, &base, &project_name)?,
        "rust"      => setup_rust_axum(&app, &event, &base, &project_name)?,
        "laravel"   => setup_laravel(&app, &event, &base, &project_name)?,
        "dotnet"    => setup_dotnet(&app, &event, &base, &project_name)?,
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
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        do_install(app, project_id, framework_id, project_name, install_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ─── Process management ────────────────────────────────────────────────────────

/// Shared map of running project processes: project_id → Child
pub struct RunningProcesses(pub Arc<Mutex<HashMap<String, Child>>>);

/// Returns the dev-server start command for the given framework.
fn get_start_command(framework_id: &str) -> &'static str {
    match framework_id {
        "react" | "vue" | "svelte" | "solid"
        | "nextjs" | "nuxt" | "astro" | "sveltekit" | "remix" => "npm run dev",
        "angular"  => "npm start",
        "nodejs"   => "node index.js",
        "fastapi"  => "uvicorn main:app --reload",
        "django"   => "python manage.py runserver",
        "go"       => "go run .",
        "rust"     => "cargo run",
        "laravel"  => "php artisan serve",
        "dotnet"   => "dotnet run",
        _          => "npm start",
    }
}

/// Kill a child process and (on Windows) its entire process tree.
fn kill_child(child: &mut Child) {
    #[cfg(target_os = "windows")]
    {
        let pid = child.id();
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Spawn the dev-server process with piped I/O, returning the Child handle.
fn spawn_dev_server(cmd_str: &str, cwd: &Path) -> Result<Child, String> {
    #[cfg(target_os = "windows")]
    let child = Command::new("cmd")
        .args(["/C", cmd_str])
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("FORCE_COLOR", "1")
        .env("COLORTERM", "truecolor")
        .spawn()
        .map_err(|e| format!("Failed to start '{}': {e}", cmd_str))?;

    #[cfg(not(target_os = "windows"))]
    let child = Command::new("sh")
        .args(["-c", cmd_str])
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("FORCE_COLOR", "1")
        .env("COLORTERM", "truecolor")
        .spawn()
        .map_err(|e| format!("Failed to start '{}': {e}", cmd_str))?;

    Ok(child)
}

/// Spawn the dev server, stream its output as events, and emit an exit event
/// when it terminates. Returns immediately after the process is spawned.
#[tauri::command]
fn start_project(
    app: tauri::AppHandle,
    state: tauri::State<'_, RunningProcesses>,
    project_id: String,
    framework_id: String,
    project_path: String,
) -> Result<(), String> {
    // Kill any previous instance for this project
    {
        let mut map = state.0.lock().unwrap();
        if let Some(mut old) = map.remove(&project_id) {
            kill_child(&mut old);
        }
    }

    let cmd_str = get_start_command(&framework_id);
    let out_event  = format!("process_output_{}", project_id);
    let exit_event = format!("process_exit_{}", project_id);

    emit_line(&app, &out_event, "info", &format!("  ▶  {}", cmd_str));
    emit_line(&app, &out_event, "info", "");

    let mut child = spawn_dev_server(cmd_str, Path::new(&project_path))?;

    // Extract I/O handles before storing the child
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    // Store the child so stop_project can kill it
    state.0.lock().unwrap().insert(project_id.clone(), child);
    let processes = state.0.clone(); // Arc clone — shared with background thread

    // Stream stdout
    let app1 = app.clone(); let ev1 = out_event.clone();
    let t_out = thread::spawn(move || {
        for line in BufReader::new(stdout).lines().flatten() {
            emit_line(&app1, &ev1, "out", &line);
        }
    });

    // Stream stderr  (npm/vite use stderr for progress — show in amber via "err" kind)
    let app2 = app.clone(); let ev2 = out_event.clone();
    let t_err = thread::spawn(move || {
        for line in BufReader::new(stderr).lines().flatten() {
            emit_line(&app2, &ev2, "err", &line);
        }
    });

    // Background thread: wait for I/O to drain, get exit code, emit exit event
    thread::spawn(move || {
        let _ = t_out.join();
        let _ = t_err.join();

        // Remove child from map (may already be gone if stop_project was called)
        let exit_code: Option<i32> = {
            let mut map = processes.lock().unwrap();
            if let Some(mut child) = map.remove(&project_id) {
                child.wait().ok().and_then(|s| s.code())
            } else {
                None // killed by stop_project
            }
        };

        let _ = app.emit(&exit_event, exit_code);
    });

    Ok(())
}

/// Kill the running dev server for a project.
#[tauri::command]
fn stop_project(
    state: tauri::State<'_, RunningProcesses>,
    project_id: String,
) -> Result<(), String> {
    let child = state.0.lock().unwrap().remove(&project_id);
    if let Some(mut child) = child {
        kill_child(&mut child);
    }
    Ok(())
}

// ─── Misc ──────────────────────────────────────────────────────────────────────

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// ─── App entry ────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RunningProcesses(Arc::new(Mutex::new(HashMap::new()))))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            install_project,
            start_project,
            stop_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
