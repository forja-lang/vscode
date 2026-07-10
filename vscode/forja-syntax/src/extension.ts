// Forja VSCode Extension — Enhanced v0.4.0
// Fase 2: Commands, Status Bar, Terminal, Tasks, Config
// Fase 3: Debug Adapter Protocol (DebugAdapterDescriptorFactory + DebugConfigurationProvider)
// Fase 4: Webviews (REPL, Tutorial, WASM Playground, Diagram Viewer)
// Fase 5: Hot Reload / Hot Restart
// Fase 6: Cross-compilation Android
// Fase 7: Tree Views (Project Outline, Forja Examples, Stdlib Browser)
// Proporciona 30+ comandos, status bar con selector de VM/target,
// terminal dedicada, task provider, snippets, configuraciones, debug DAP,
// paneles webview interactivos, y tree views con análisis de proyecto.

import * as path from 'path';
import * as fs from 'fs';
import { exec, spawn, ChildProcess } from 'child_process';
import {
    ExtensionContext,
    workspace,
    window,
    commands,
    StatusBarItem,
    StatusBarAlignment,
    Terminal,
    Task,
    TaskDefinition,
    TaskGroup,
    TaskScope,
    TaskProvider,
    CustomExecution,
    Pseudoterminal,
    EventEmitter,
    Uri,
    OutputChannel,
    env,
    QuickPickItem,
    tasks,
    debug,
    DebugAdapterDescriptorFactory,
    DebugAdapterDescriptor,
    DebugAdapterExecutable,
    DebugSession,
    DebugConfigurationProvider,
    DebugConfiguration,
    CancellationToken,
    WorkspaceFolder,
    ViewColumn,
    Selection,
    Range,
    TextEditorRevealType,
} from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from 'vscode-languageclient/node';

import { ForjaReplProvider } from './webviews/repl';
import { ForjaTutorialProvider } from './webviews/tutorial';
import { ForjaWasmPlaygroundProvider } from './webviews/wasm';
import { ForjaDiagramProvider } from './webviews/diagram';
import {
    ForjaExamplesProvider,
    StdlibBrowserProvider,
    ProjectOutlineProvider,
} from './treeviews';

// ======================================================================
// Hot Reload State
// ======================================================================

// Variable to hold the hot reload status bar item (created in activate)
let hotReloadStatus: StatusBarItem;

interface RunningProcess {
    process: ChildProcess;
    file: string;
    startTime: number;
    mode: 'run' | 'gui';
}

let runningProcesses: Map<string, RunningProcess> = new Map();
let hotReloadEnabled = true;

// ======================================================================
// Constants
// ======================================================================

const OUTPUT_CHANNEL_NAME = 'Forja';
const TERMINAL_NAME = 'Forja';

type VMMode = 'fastvm' | 'vm' | 'jit';
type TargetPlatform = 'native' | 'x86_64-pc-windows-msvc' | 'aarch64-linux-android' | 'x86_64-linux-android' | 'wasm32-unknown-unknown';

const VM_MODES: VMMode[] = ['fastvm', 'vm', 'jit'];
const TARGETS: TargetPlatform[] = ['native', 'x86_64-pc-windows-msvc', 'aarch64-linux-android', 'x86_64-linux-android', 'wasm32-unknown-unknown'];

const VM_LABELS: Record<VMMode, string> = {
    'fastvm': 'FastVM',
    'vm': 'VM Clásica',
    'jit': 'JIT Nativo',
};

const VM_ICONS: Record<VMMode, string> = {
    'fastvm': '$(zap)',
    'vm': '$(vm)',
    'jit': '$(rocket)',
};

type TaskName =
    | 'run' | 'run-fast' | 'run-jit' | 'run-aot'
    | 'debug' | 'gui'
    | 'build' | 'build-asm' | 'build-wasm' | 'build-android'
    | 'test' | 'bench'
    | 'fmt' | 'doc' | 'diagram' | 'transpile'
    | 'gui-hot-reload';

// ======================================================================
// State
// ======================================================================

let lspClient: LanguageClient;
let outputChannel: OutputChannel;
let forjaTerminal: Terminal | undefined;
let statusBarVM: StatusBarItem;
let statusBarTarget: StatusBarItem;
let currentVMMode: VMMode = 'fastvm';
let currentTarget: TargetPlatform = 'native';

// ======================================================================
// Activation
// ======================================================================

export function activate(context: ExtensionContext) {
    outputChannel = window.createOutputChannel(OUTPUT_CHANNEL_NAME, 'forja');
    outputChannel.appendLine('Forja Extension v0.4.0 activada');

    // ── Load settings ──
    currentVMMode = workspace.getConfiguration('forja').get<VMMode>('defaultVM', 'fastvm');
    currentTarget = workspace.getConfiguration('forja').get<TargetPlatform>('defaultTarget', 'native');
    hotReloadEnabled = workspace.getConfiguration('forja').get<boolean>('hotReload.enabled', true);

    // ── LSP Client ──
    startLSPClient(context);

    // ── Status Bar ──
    statusBarVM = window.createStatusBarItem(StatusBarAlignment.Left, 100);
    statusBarVM.command = 'forja.selectVM';
    statusBarVM.tooltip = 'Haz clic para cambiar la VM por defecto';
    context.subscriptions.push(statusBarVM);

    statusBarTarget = window.createStatusBarItem(StatusBarAlignment.Left, 99);
    statusBarTarget.command = 'forja.selectTarget';
    statusBarTarget.tooltip = 'Haz clic para cambiar la plataforma target';
    context.subscriptions.push(statusBarTarget);

    // ── Register All Commands ──
    registerCommands(context);

    // ── Task Provider ──
    context.subscriptions.push(
        tasks.registerTaskProvider('forja', new ForjaTaskProvider())
    );

    // ── Debug Adapter ──
    context.subscriptions.push(
        debug.registerDebugAdapterDescriptorFactory('forja', new ForjaDebugAdapterDescriptorFactory(context))
    );
    context.subscriptions.push(
        debug.registerDebugConfigurationProvider('forja', new ForjaDebugConfigurationProvider())
    );

    // ── Webview Providers (Fase 4) ──
    const replProvider = new ForjaReplProvider(context.extensionUri);
    context.subscriptions.push(
        window.registerWebviewViewProvider(ForjaReplProvider.viewType, replProvider)
    );

    const tutorialProvider = new ForjaTutorialProvider(context.extensionUri);
    context.subscriptions.push(
        window.registerWebviewViewProvider(ForjaTutorialProvider.viewType, tutorialProvider)
    );

    const wasmProvider = new ForjaWasmPlaygroundProvider(context.extensionUri);
    context.subscriptions.push(
        window.registerWebviewViewProvider(ForjaWasmPlaygroundProvider.viewType, wasmProvider)
    );

    const diagramProvider = new ForjaDiagramProvider(context.extensionUri);
    context.subscriptions.push(
        window.registerWebviewViewProvider(ForjaDiagramProvider.viewType, diagramProvider)
    );

    // ── Tree View Providers (Fase 7.2) ──
    const projectOutlineProvider = new ProjectOutlineProvider();
    context.subscriptions.push(
        window.registerTreeDataProvider('forja.projectOutline', projectOutlineProvider)
    );
    // Refresh outline on active editor change
    context.subscriptions.push(
        window.onDidChangeActiveTextEditor(() => projectOutlineProvider.refresh())
    );

    const examplesProvider = new ForjaExamplesProvider(context);
    context.subscriptions.push(
        window.registerTreeDataProvider('forja.examples', examplesProvider)
    );

    const stdlibProvider = new StdlibBrowserProvider(context);
    context.subscriptions.push(
        window.registerTreeDataProvider('forja.stdlib', stdlibProvider)
    );

    // ── Hot Reload Status Bar ──
    hotReloadStatus = window.createStatusBarItem(StatusBarAlignment.Left, 98);
    hotReloadStatus.command = 'forja.toggleHotReload';
    hotReloadStatus.tooltip = 'Haz clic para activar/desactivar Hot Reload';
    context.subscriptions.push(hotReloadStatus);

    // ── Hot Reload on Save ──
    context.subscriptions.push(
        workspace.onDidSaveTextDocument(async (doc) => {
            if (!hotReloadEnabled) return;
            if (doc.languageId !== 'forja') return;

            const filePath = doc.fileName;
            outputChannel.appendLine(`Archivo guardado: ${filePath}`);

            const running = runningProcesses.get(filePath);
            if (running) {
                outputChannel.appendLine(`Hot Reload: ${running.mode} → ${filePath}`);
                await killProcess(filePath);
                startProcess(filePath, running.mode);
            }
        })
    );

    // ── Initial status bar update ──
    updateStatusBar();

    outputChannel.appendLine('Forja Extension lista - todos los comandos registrados');
}

export function deactivate(): Thenable<void> | undefined {
    if (lspClient) {
        return lspClient.stop();
    }
    return undefined;
}

// ======================================================================
// LSP Client
// ======================================================================

function startLSPClient(context: ExtensionContext) {
    const configLspEnabled = workspace.getConfiguration('forja').get<boolean>('lsp.enabled', true);
    if (!configLspEnabled) {
        outputChannel.appendLine('LSP deshabilitado por configuración');
        return;
    }

    // Determine server path: config override or auto-detect
    let serverPath = workspace.getConfiguration('forja').get<string>('lsp.path', '');
    if (!serverPath) {
        // Try project-relative binary first, then PATH
        const relPath = context.asAbsolutePath(path.join('..', 'target', 'debug', 'forja-lsp.exe'));
        if (fs.existsSync(relPath)) {
            serverPath = relPath;
        } else {
            // Check release build
            const relReleasePath = context.asAbsolutePath(path.join('..', 'target', 'release', 'forja-lsp.exe'));
            if (fs.existsSync(relReleasePath)) {
                serverPath = relReleasePath;
            } else {
                // Try on PATH
                const whichResult = findOnPath('forja-lsp');
                if (whichResult) {
                    serverPath = whichResult;
                } else {
                    outputChannel.appendLine('forja-lsp no encontrado. LSP deshabilitado. Compila con: cargo build --features lsp');
                    window.showWarningMessage(
                        'forja-lsp no encontrado. El análisis de código en tiempo real no estará disponible. ' +
                        'Compila el binario con: cargo build --features lsp',
                        'Entendido'
                    );
                    return;
                }
            }
        }
    }

    const serverOptions: ServerOptions = {
        run: { command: serverPath, transport: TransportKind.stdio },
        debug: { command: serverPath, transport: TransportKind.stdio },
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'forja' }],
        synchronize: {
            fileEvents: workspace.createFileSystemWatcher('**/*.fa'),
        },
        outputChannel: outputChannel,
        traceOutputChannel: outputChannel,
    };

    lspClient = new LanguageClient('forja-lsp', 'Forja Language Server', serverOptions, clientOptions);
    lspClient.start();
    outputChannel.appendLine(`LSP client started: ${serverPath}`);
}

// ======================================================================
// Status Bar
// ======================================================================

function updateStatusBar() {
    statusBarVM.text = `${VM_ICONS[currentVMMode]} ${VM_LABELS[currentVMMode]}`;
    statusBarVM.show();

    const targetLabel = currentTarget === 'native' ? 'Nativo'
        : currentTarget === 'wasm32-unknown-unknown' ? 'WASM'
        : currentTarget.includes('android') ? 'Android'
        : currentTarget;
    statusBarTarget.text = `$(target) ${targetLabel}`;
    statusBarTarget.show();

    // Update hot reload indicator
    if (hotReloadStatus) {
        const count = runningProcesses.size;
        if (!hotReloadEnabled) {
            hotReloadStatus.text = '$(circle-slash) HR off';
        } else if (count > 0) {
            hotReloadStatus.text = `$(sync) HR ${count}`;
        } else {
            hotReloadStatus.text = '$(circle-outline) HR';
        }
        hotReloadStatus.show();
    }
}

// ======================================================================
// Commands
// ======================================================================

function registerCommands(context: ExtensionContext) {
    // ── Execution Commands ──

    // Run original VM
    const cmdRun = commands.registerCommand('forja.run', () => {
        executeCommand('run', ['run']);
    });
    context.subscriptions.push(cmdRun);

    // Run FastVM
    const cmdRunFast = commands.registerCommand('forja.runFast', () => {
        executeCommand('run', ['run', '--fast']);
    });
    context.subscriptions.push(cmdRunFast);

    // Run JIT
    const cmdRunJIT = commands.registerCommand('forja.runJIT', () => {
        executeCommand('run', ['run', '--jit']);
    });
    context.subscriptions.push(cmdRunJIT);

    // Run AOT (LLVM)
    const cmdRunAOT = commands.registerCommand('forja.runAOT', () => {
        executeCommand('run', ['run', '--aot']);
    });
    context.subscriptions.push(cmdRunAOT);

    // Run Debug — ahora usa DAP en vez de terminal
    const cmdRunDebug = commands.registerCommand('forja.runDebug', () => {
        const editor = window.activeTextEditor;
        if (!editor) {
            window.showErrorMessage('No hay ningún editor activo');
            return;
        }
        if (editor.document.languageId !== 'forja') {
            window.showErrorMessage('El archivo activo no es un archivo Forja (.fa)');
            return;
        }
        // Iniciar debug session DAP
        debug.startDebugging(workspace.workspaceFolders?.[0], {
            type: 'forja',
            name: 'Forja: Debug archivo activo',
            request: 'launch',
            program: editor.document.fileName,
        });
    });
    context.subscriptions.push(cmdRunDebug);

    // Run GUI
    const cmdRunGUI = commands.registerCommand('forja.runGUI', () => {
        executeCommand('run', ['run', '--gui']);
    });
    context.subscriptions.push(cmdRunGUI);

    // Open REPL (Webview)
    const cmdRepl = commands.registerCommand('forja.runRepl', () => {
        // Focus the REPL webview view
        commands.executeCommand('workbench.view.extension.forja-repl');
    });
    context.subscriptions.push(cmdRepl);

    // ── Webview Commands (Fase 4) ──

    const cmdOpenTutorial = commands.registerCommand('forja.openTutorial', () => {
        commands.executeCommand('workbench.view.extension.forja-tutorial');
    });
    context.subscriptions.push(cmdOpenTutorial);

    const cmdOpenWasm = commands.registerCommand('forja.openWasmPlayground', () => {
        commands.executeCommand('workbench.view.extension.forja-wasm');
    });
    context.subscriptions.push(cmdOpenWasm);

    const cmdOpenDiagram = commands.registerCommand('forja.openDiagram', () => {
        commands.executeCommand('workbench.view.extension.forja-diagram');
    });
    context.subscriptions.push(cmdOpenDiagram);

    // ── Build Commands ──

    // Build (bytecode)
    const cmdBuild = commands.registerCommand('forja.build', () => {
        executeCommand('build', ['build']);
    });
    context.subscriptions.push(cmdBuild);

    // Build ASM
    const cmdBuildASM = commands.registerCommand('forja.buildASM', () => {
        executeCommand('build-asm', ['build', '--asm']);
    });
    context.subscriptions.push(cmdBuildASM);

    // Build WASM
    const cmdBuildWASM = commands.registerCommand('forja.buildWASM', () => {
        executeCommand('build-wasm', ['build', '--target', 'wasm32-unknown-unknown']);
    });
    context.subscriptions.push(cmdBuildWASM);

    // ── Android Cross-Compilation (Fase 6) ──

    /**
     * Run a shell script with bash and show output in terminal.
     */
    function runAndroidScript(script: string, args: string[] = []) {
        const scriptPath = path.join(context.extensionPath, 'scripts', script);
        if (!fs.existsSync(scriptPath)) {
            window.showErrorMessage(`Script no encontrado: ${scriptPath}`);
            return;
        }
        const cmd = `bash "${scriptPath}"${args.length > 0 ? ' ' + args.join(' ') : ''}`;
        const terminal = window.createTerminal({ name: 'Forja Android', cwd: context.extensionPath });
        terminal.sendText(cmd);
        terminal.show();
    }

    // Build Android (ARM64) — script-based
    const cmdBuildAndroid = commands.registerCommand('forja.buildAndroid', () => {
        runAndroidScript('build-android.sh', ['aarch64-linux-android']);
    });
    context.subscriptions.push(cmdBuildAndroid);

    // Build Android ARM64 (explicit)
    const cmdBuildAndroidArm64 = commands.registerCommand('forja.buildAndroid.arm64', () => {
        runAndroidScript('build-android.sh', ['aarch64-linux-android']);
    });
    context.subscriptions.push(cmdBuildAndroidArm64);

    // Build Android x86_64
    const cmdBuildAndroidX86_64 = commands.registerCommand('forja.buildAndroid.x86_64', () => {
        runAndroidScript('build-android.sh', ['x86_64-linux-android']);
    });
    context.subscriptions.push(cmdBuildAndroidX86_64);

    // Build Android ALL targets
    const cmdBuildAndroidAll = commands.registerCommand('forja.buildAndroid.all', () => {
        runAndroidScript('build-android.sh', []);
    });
    context.subscriptions.push(cmdBuildAndroidAll);

    // Check NDK setup (validation only)
    const cmdCheckNDK = commands.registerCommand('forja.checkAndroidNDK', () => {
        runAndroidScript('toolchain-android.sh', ['check']);
    });
    context.subscriptions.push(cmdCheckNDK);

    // Deploy to Android device via ADB
    const cmdDeployAndroid = commands.registerCommand('forja.deployAndroid', async () => {
        // First detect device
        const adbPath = findOnPath('adb');
        if (!adbPath) {
            window.showErrorMessage(
                'ADB no encontrado en PATH. Instala Android Platform Tools.',
                'Entendido'
            );
            return;
        }

        outputChannel.appendLine('Detectando dispositivos Android...');
        exec('adb devices', (err: Error | null, stdout: string) => {
            if (err) {
                window.showErrorMessage(`Error ejecutando ADB: ${err.message}`);
                return;
            }
            const lines = stdout.trim().split('\n').filter(l => l.includes('\tdevice'));
            if (lines.length === 0) {
                window.showErrorMessage(
                    'No se detectaron dispositivos Android conectados.',
                    'Entendido'
                );
                return;
            }

            const deviceId = lines[0].split('\t')[0];
            outputChannel.appendLine(`Dispositivo detectado: ${deviceId}`);

            // Ask user for binary path
            window.showInputBox({
                prompt: 'Ruta al binario Forja compilado para Android',
                placeHolder: 'target/aarch64-linux-android/release/forja.exe',
            }).then(binaryPath => {
                if (!binaryPath) return;

                const remotePath = `/data/local/tmp/forja`;
                const pushCmd = `adb -s ${deviceId} push "${binaryPath}" ${remotePath}`;
                const chmodCmd = `adb -s ${deviceId} shell chmod +x ${remotePath}`;

                const terminal = window.createTerminal({ name: 'Forja ADB Deploy' });
                terminal.sendText(`${pushCmd} && ${chmodCmd} && echo "Deploy completo: ${remotePath}"`);
                terminal.show();
            });
        });
    });
    context.subscriptions.push(cmdDeployAndroid);

    // ── Testing & Benchmarking ──

    const cmdTest = commands.registerCommand('forja.test', () => {
        executeCommand('test', ['test']);
    });
    context.subscriptions.push(cmdTest);

    const cmdBench = commands.registerCommand('forja.bench', () => {
        executeCommand('bench', ['bench']);
    });
    context.subscriptions.push(cmdBench);

    // ── Tooling Commands ──

    // Format
    const cmdFmt = commands.registerCommand('forja.fmt', () => {
        executeCommand('fmt', ['fmt']);
    });
    context.subscriptions.push(cmdFmt);

    // Generate docs
    const cmdDoc = commands.registerCommand('forja.doc', () => {
        executeCommand('doc', ['doc']);
    });
    context.subscriptions.push(cmdDoc);

    // Generate diagram
    const cmdDiagram = commands.registerCommand('forja.diagram', () => {
        executeCommand('diagram', ['diagram']);
    });
    context.subscriptions.push(cmdDiagram);

    // Transpile to Rust
    const cmdTranspile = commands.registerCommand('forja.transpile', () => {
        executeCommand('transpile', ['transpile']);
    });
    context.subscriptions.push(cmdTranspile);

    // ── Hot Reload / Restart ──

    // Hot Reload: kill and re-run the current file
    const cmdHotReload = commands.registerCommand('forja.hotReload', async () => {
        const editor = window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'forja') {
            window.showErrorMessage('No hay un archivo Forja activo');
            return;
        }
        const filePath = editor.document.fileName;
        const running = runningProcesses.get(filePath);
        if (running) {
            outputChannel.appendLine(`Hot Reload forzado: ${filePath}`);
            await killProcess(filePath);
            startProcess(filePath, running.mode);
        } else {
            // No running process, start one
            startProcess(filePath, 'run');
        }
    });
    context.subscriptions.push(cmdHotReload);

    // Hot Restart: kill ALL running processes and start fresh
    const cmdHotRestart = commands.registerCommand('forja.hotRestart', async () => {
        const count = runningProcesses.size;
        if (count === 0) {
            window.showInformationMessage('No hay procesos activos para reiniciar');
            return;
        }
        outputChannel.appendLine(`Hot Restart: reiniciando ${count} proceso(s)`);
        for (const [file] of runningProcesses) {
            await killProcess(file);
            // Re-start each
            // (they'll be re-started by onDidSaveTextDocument when saved)
        }
        window.showInformationMessage(`Se reiniciaron ${count} proceso(s). Guarda los archivos para re-ejecutar.`);
    });
    context.subscriptions.push(cmdHotRestart);

    // Toggle hot reload on/off
    const cmdToggleHotReload = commands.registerCommand('forja.toggleHotReload', () => {
        hotReloadEnabled = !hotReloadEnabled;
        workspace.getConfiguration('forja').update('hotReload.enabled', hotReloadEnabled, true);
        const msg = hotReloadEnabled ? 'Hot Reload activado' : 'Hot Reload desactivado';
        window.showInformationMessage(msg);
        outputChannel.appendLine(msg);
        updateStatusBar();
    });
    context.subscriptions.push(cmdToggleHotReload);

    // ── Project & Toolchain ──

    const cmdNewProject = commands.registerCommand('forja.newProject', async () => {
        const folder = await window.showInputBox({
            prompt: 'Nombre del nuevo proyecto Forja',
            placeHolder: 'mi-proyecto',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'El nombre no puede estar vacío';
                }
                if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value)) {
                    return 'Usa solo letras, números, guiones y guiones bajos';
                }
                return null;
            },
        });
        if (folder) {
            const targetUri = workspace.workspaceFolders?.[0]?.uri;
            if (targetUri) {
                const projectPath = path.join(targetUri.fsPath, folder);
                getOrCreateTerminal().sendText(`forja new "${projectPath}"`);
                getOrCreateTerminal().show();
            } else {
                window.showErrorMessage('No hay ninguna carpeta de workspace abierta');
            }
        }
    });
    context.subscriptions.push(cmdNewProject);

    const cmdInstallToolchain = commands.registerCommand('forja.installToolchain', () => {
        const terminal = window.createTerminal('Forja Toolchain');
        terminal.sendText('cargo build --features lsp,dap');
        terminal.sendText('');
        terminal.sendText('echo "Si necesitas Android NDK, instala Android Studio o configura ANDROID_NDK_HOME"');
        terminal.show();
    });
    context.subscriptions.push(cmdInstallToolchain);

    // ── VM / Target Selectors ──

    const cmdSelectVM = commands.registerCommand('forja.selectVM', async () => {
        const items: (QuickPickItem & { value: VMMode })[] = VM_MODES.map((mode) => ({
            label: `${VM_ICONS[mode]} ${VM_LABELS[mode]}`,
            description: mode === 'fastvm' ? 'Por defecto, ultra-rápida'
                : mode === 'vm' ? 'VM original, estable'
                : 'Compilación JIT nativa con fallback',
            value: mode,
        }));

        const picked = await window.showQuickPick(items, {
            placeHolder: 'Seleccionar VM por defecto',
        });

        if (picked) {
            currentVMMode = picked.value;
            await workspace.getConfiguration('forja').update('defaultVM', picked.value, true);
            updateStatusBar();
            outputChannel.appendLine(`VM cambiada a: ${picked.value}`);

            window.showInformationMessage(`VM por defecto cambiada a: ${VM_LABELS[picked.value]}`, 'OK');
        }
    });
    context.subscriptions.push(cmdSelectVM);

    const cmdSelectTarget = commands.registerCommand('forja.selectTarget', async () => {
        const items: (QuickPickItem & { value: TargetPlatform })[] = TARGETS.map((target) => ({
            label: `$(target) ${target}`,
            description: target === 'native' ? 'Plataforma actual (por defecto)'
                : target === 'wasm32-unknown-unknown' ? 'WebAssembly'
                : target.includes('android') ? 'Android (cross-compile)'
                : 'Windows MSVC',
            value: target,
        }));

        const picked = await window.showQuickPick(items, {
            placeHolder: 'Seleccionar plataforma target',
        });

        if (picked) {
            currentTarget = picked.value;
            await workspace.getConfiguration('forja').update('defaultTarget', picked.value, true);
            updateStatusBar();
            outputChannel.appendLine(`Target cambiado a: ${picked.value}`);
            window.showInformationMessage(`Target cambiado a: ${picked.value}`, 'OK');
        }
    });
    context.subscriptions.push(cmdSelectTarget);

    // Show output channel
    const cmdShowOutput = commands.registerCommand('forja.showOutput', () => {
        outputChannel.show();
    });
    context.subscriptions.push(cmdShowOutput);

    // ── Developer Tools (Fase 7.3) ──

    // Show AST of active file
    const cmdShowAST = commands.registerCommand('forja.showAST', async () => {
        const editor = window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'forja') {
            window.showErrorMessage('No hay un archivo Forja activo');
            return;
        }
        const source = editor.document.getText();
        try {
            const terminal = getOrCreateTerminal();
            terminal.sendText(`forja ast "${editor.document.fileName}"`);
            terminal.show();
        } catch (e: any) {
            window.showErrorMessage(`Error: ${e.message}`);
        }
    });
    context.subscriptions.push(cmdShowAST);

    // Show Bytecode of active file
    const cmdShowBytecode = commands.registerCommand('forja.showBytecode', async () => {
        const editor = window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'forja') {
            window.showErrorMessage('No hay un archivo Forja activo');
            return;
        }
        try {
            const terminal = getOrCreateTerminal();
            terminal.sendText(`forja build "${editor.document.fileName}" --emit-bytecode`);
            terminal.show();
        } catch (e: any) {
            window.showErrorMessage(`Error: ${e.message}`);
        }
    });
    context.subscriptions.push(cmdShowBytecode);

    // Open stdlib file
    const cmdOpenStdlib = commands.registerCommand('forja.openStdlib', async () => {
        const wsFolders = workspace.workspaceFolders;
        if (!wsFolders || wsFolders.length === 0) {
            window.showErrorMessage('No hay workspace abierto');
            return;
        }
        const stdlibPath = path.join(wsFolders[0].uri.fsPath, 'stdlib');
        if (!fs.existsSync(stdlibPath)) {
            window.showErrorMessage('La carpeta stdlib no existe en el workspace actual');
            return;
        }
        try {
            const files = fs.readdirSync(stdlibPath).filter(f => f.endsWith('.fa'));
            const picked = await window.showQuickPick(files, {
                placeHolder: 'Seleccionar archivo de stdlib',
            });
            if (picked) {
                const doc = await workspace.openTextDocument(path.join(stdlibPath, picked));
                await window.showTextDocument(doc);
            }
        } catch (e: any) {
            window.showErrorMessage(`Error: ${e.message}`);
        }
    });
    context.subscriptions.push(cmdOpenStdlib);

    // Open file (used by TreeView commands)
    const cmdOpenFile = commands.registerCommand('forja.openFile', (uri: Uri) => {
        workspace.openTextDocument(uri).then(doc => window.showTextDocument(doc));
    });
    context.subscriptions.push(cmdOpenFile);

    // Reveal line (used by Project Outline)
    const cmdRevealLine = commands.registerCommand('forja.revealLine', (uri: Uri, line: number) => {
        workspace.openTextDocument(uri).then(doc => {
            window.showTextDocument(doc).then(editor => {
                const position = editor.selection.active.with(line - 1, 0);
                editor.selection = new Selection(position, position);
                editor.revealRange(
                    new Range(position, position),
                    TextEditorRevealType.InCenter
                );
            });
        });
    });
    context.subscriptions.push(cmdRevealLine);
}

/**
 * Kill a running process by file path.
 */
function killProcess(filePath: string): Promise<void> {
    return new Promise((resolve) => {
        const entry = runningProcesses.get(filePath);
        if (!entry) { resolve(); return; }
        const { process: proc } = entry;
        runningProcesses.delete(filePath);
        updateStatusBar();

        try {
            if (process.platform === 'win32') {
                // On Windows, taskkill is more reliable
                const kill = spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t']);
                kill.on('close', () => resolve());
                kill.on('error', () => resolve());
                setTimeout(resolve, 1000);
            } else {
                proc.kill('SIGTERM');
                setTimeout(() => {
                    try { proc.kill('SIGKILL'); } catch {}
                    resolve();
                }, 2000);
            }
        } catch {
            resolve();
        }
    });
}

/**
 * Start a Forja process and track it for hot reload.
 */
function startProcess(filePath: string, mode: 'run' | 'gui') {
    // Kill existing if any
    if (runningProcesses.has(filePath)) {
        killProcess(filePath);
    }

    const cmd = 'forja';
    const vmFlag = currentVMMode === 'fastvm' ? '--fast' : currentVMMode === 'jit' ? '--jit' : '';
    const modeFlag = mode === 'gui' ? '--gui' : '';
    const args = ['run', vmFlag, modeFlag, `"${filePath}"`].filter(Boolean);

    const childProc = spawn(cmd, args, {
        cwd: path.dirname(filePath),
        windowsHide: true,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    const entry: RunningProcess = {
        process: childProc,
        file: filePath,
        startTime: Date.now(),
        mode,
    };

    runningProcesses.set(filePath, entry);
    updateStatusBar();

    outputChannel.appendLine(`Proceso iniciado: ${cmd} ${args.join(' ')} (PID: ${childProc.pid})`);

    childProc.stdout?.on('data', (data: string | Buffer) => {
        outputChannel.append(data.toString());
    });

    childProc.stderr?.on('data', (data: string | Buffer) => {
        outputChannel.append(`[${mode}] ${data.toString()}`);
    });

    childProc.on('close', (code: number | null) => {
        // Only clean up if this is still the current entry
        if (runningProcesses.get(filePath)?.process === childProc) {
            runningProcesses.delete(filePath);
            updateStatusBar();
        }
        outputChannel.appendLine(`Proceso terminado (PID: ${childProc.pid}, codigo: ${code})`);
    });

    childProc.on('error', (err: Error) => {
        outputChannel.appendLine(`Error iniciando proceso: ${err.message}`);
        if (runningProcesses.get(filePath)?.process === childProc) {
            runningProcesses.delete(filePath);
            updateStatusBar();
        }
    });
}

// ======================================================================
// Execution Helper
// ======================================================================

/**
 * Execute a CLI command for the active Forja file.
 * Supports 3 modes:
 *   - Task execution (for build/test/bench)
 *   - Terminal execution (for run/debug/gui)
 *   - Direct command (for tools like fmt/doc)
 */
function executeCommand(taskName: TaskName, args: string[]) {
    const editor = window.activeTextEditor;
    if (!editor) {
        window.showErrorMessage('No hay ningún editor activo');
        return;
    }

    const document = editor.document;
    if (document.languageId !== 'forja') {
        window.showErrorMessage('El archivo activo no es un archivo Forja (.fa)');
        return;
    }

    // Build the command
    const filePath = document.fileName;
    const extraArgs = workspace.getConfiguration('forja').get<string>('buildArgs', '');
    const allArgs = [...args, `"${filePath}"`, extraArgs].filter(a => a).join(' ');

    // Determine execution strategy based on task type
    const isBuildTask = taskName === 'build' || taskName === 'build-asm' || taskName === 'build-wasm' || taskName === 'build-android';
    const isToolTask = taskName === 'fmt' || taskName === 'doc' || taskName === 'diagram' || taskName === 'transpile';

    // For build and tool tasks, we let the user see results
    const cmd = `forja ${allArgs}`;
    const terminal = getOrCreateTerminal();

    // Clear terminal if configured
    if (workspace.getConfiguration('forja').get<boolean>('terminal.clearBeforeRun', false)) {
        terminal.sendText(undefined as any); // undefined sends clear via special handling
    }

    if (workspace.getConfiguration('forja').get<boolean>('terminal.preserveFocus', false)) {
        terminal.sendText(cmd);
    } else {
        terminal.sendText(cmd);
        terminal.show();
    }

    outputChannel.appendLine(`Ejecutando: ${cmd}`);
}

/**
 * Get or create the Forja-dedicated terminal.
 */
function getOrCreateTerminal(): Terminal {
    if (forjaTerminal === undefined) {
        forjaTerminal = window.createTerminal(TERMINAL_NAME);
        // Handle terminal close
        window.onDidCloseTerminal((t) => {
            if (t.name === TERMINAL_NAME) {
                forjaTerminal = undefined;
            }
        });
    }
    return forjaTerminal;
}

// ======================================================================
// Debug Adapter
// ======================================================================

class ForjaDebugAdapterDescriptorFactory implements DebugAdapterDescriptorFactory {
    constructor(private context: ExtensionContext) {}

    createDebugAdapterDescriptor(_session: DebugSession): DebugAdapterDescriptor | undefined {
        const dapPath = findDapBinary(this.context);
        if (!dapPath) {
            const msg = 'forja-dap no encontrado. Compila con: cargo build --features dap';
            outputChannel.appendLine('[ADVERTENCIA] ' + msg);
            window.showErrorMessage(msg, 'Entendido');
            return undefined;
        }
        outputChannel.appendLine(`DAP binary: ${dapPath}`);
        return new DebugAdapterExecutable(dapPath, []);
    }
}

class ForjaDebugConfigurationProvider implements DebugConfigurationProvider {
    provideDebugConfigurations(_folder: WorkspaceFolder | undefined, _token?: CancellationToken): DebugConfiguration[] {
        return [
            {
                type: 'forja',
                request: 'launch',
                name: 'Forja: Debug archivo activo',
                program: '${file}',
            },
        ];
    }

    resolveDebugConfiguration(
        _folder: WorkspaceFolder | undefined,
        debugConfiguration: DebugConfiguration,
        _token?: CancellationToken
    ): DebugConfiguration | undefined {
        // If no program specified, use active editor
        if (!debugConfiguration.program) {
            const editor = window.activeTextEditor;
            if (editor && editor.document.languageId === 'forja') {
                debugConfiguration.program = editor.document.fileName;
            }
        }
        return debugConfiguration;
    }
}

/**
 * Find the forja-dap binary in the project build directory or on PATH.
 */
function findDapBinary(context: ExtensionContext): string | undefined {
    const isWindows = process.platform === 'win32';
    const exeName = `forja-dap${isWindows ? '.exe' : ''}`;

    const debugPath = context.asAbsolutePath(path.join('..', 'target', 'debug', exeName));
    if (fs.existsSync(debugPath)) {
        return debugPath;
    }

    const releasePath = context.asAbsolutePath(path.join('..', 'target', 'release', exeName));
    if (fs.existsSync(releasePath)) {
        return releasePath;
    }

    return findOnPath('forja-dap');
}

// ======================================================================
// Task Provider
// ======================================================================

interface ForjaTaskDefinition extends TaskDefinition {
    task: TaskName;
    args?: string;
}

class ForjaTaskProvider implements TaskProvider {
    async provideTasks(): Promise<Task[]> {
        const tasks: Task[] = [];
        const editors = window.visibleTextEditors.filter(e => e.document.languageId === 'forja');
        if (editors.length === 0) {
            return [];
        }

        const filePath = editors[0].document.fileName;

        // Generate tasks for common operations
        const taskConfigs: { name: TaskName; label: string; group: TaskGroup; cmdArgs: string }[] = [
            { name: 'run', label: 'Run (FastVM)', group: TaskGroup.Build, cmdArgs: 'run --fast' },
            { name: 'run-jit', label: 'Run (JIT)', group: TaskGroup.Build, cmdArgs: 'run --jit' },
            { name: 'test', label: 'Run tests', group: TaskGroup.Test, cmdArgs: 'test' },
            { name: 'build', label: 'Build bytecode', group: TaskGroup.Build, cmdArgs: 'build' },
            { name: 'build-asm', label: 'Build to ASM', group: TaskGroup.Build, cmdArgs: 'build --asm' },
            { name: 'build-wasm', label: 'Build to WASM', group: TaskGroup.Build, cmdArgs: 'build --target wasm32-unknown-unknown' },
        ];

        for (const cfg of taskConfigs) {
            const definition: ForjaTaskDefinition = {
                type: 'forja',
                task: cfg.name,
            };

            const task = new Task(
                definition,
                TaskScope.Workspace,
                `Forja: ${cfg.label}`,
                'forja',
                new CustomExecution(
                    async (): Promise<Pseudoterminal> => {
                        return new ForjaPseudoterminal(`forja ${cfg.cmdArgs} "${filePath}"`);
                    }
                ),
                '$(zap)',
            );
            task.group = cfg.group;

            tasks.push(task);
        }

        return tasks;
    }

    resolveTask(_task: Task): Task | undefined {
        return _task;
    }
}

class ForjaPseudoterminal implements Pseudoterminal {
    private writeEmitter = new EventEmitter<string>();
    private closeEmitter = new EventEmitter<void>();

    readonly onDidWrite = this.writeEmitter.event;
    readonly onDidClose = this.closeEmitter.event;

    constructor(private command: string) {}

    open(_initialDimensions: any): void {
        this.writeEmitter.fire(`Ejecutando: ${this.command}\r\n\r\n`);
        const child = exec(this.command, {
            cwd: workspace.workspaceFolders?.[0]?.uri?.fsPath,
            windowsHide: true,
        });

        child.stdout?.on('data', (data: string) => {
            this.writeEmitter.fire(data);
        });

        child.stderr?.on('data', (data: string) => {
            this.writeEmitter.fire(data);
        });

        child.on('close', (code: number) => {
            this.writeEmitter.fire(`\r\nProceso terminado con código: ${code}\r\n`);
            this.closeEmitter.fire();
        });

        child.on('error', (err: Error) => {
            this.writeEmitter.fire(`\r\nError: ${err.message}\r\n`);
            this.closeEmitter.fire();
        });
    }

    close(): void {
        // no-op
    }
}

// ======================================================================
// Utility
// ======================================================================

function findOnPath(binaryName: string): string | undefined {
    const isWindows = process.platform === 'win32';
    const exeName = isWindows ? `${binaryName}.exe` : binaryName;
    const pathDirs = (process.env.PATH || '').split(path.delimiter);

    for (const dir of pathDirs) {
        try {
            const fullPath = path.join(dir, exeName);
            if (fs.existsSync(fullPath)) {
                return fullPath;
            }
        } catch {
            continue;
        }
    }
    return undefined;
}
