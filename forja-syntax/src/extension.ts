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
import * as vscode from 'vscode';
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
    TextEditor,
    TextEditorDecorationType,
    TextDocument,
} from 'vscode';

import { ForjaDiagramProvider } from './webviews/diagram';

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

let lspClient: any;
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

    // ── Apply Forja syntax colors ──
    setupForjaHighlighter(context);

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
    const diagramProvider = new ForjaDiagramProvider(context.extensionUri);
    context.subscriptions.push(
        window.registerWebviewViewProvider(ForjaDiagramProvider.viewType, diagramProvider)
    );

    // Refresh diagram on active editor change
    context.subscriptions.push(
        window.onDidChangeActiveTextEditor(() => {
            updateToolbarVisibility();
            diagramProvider.updateActiveDiagram();
        })
    );

    // ── Hot Reload Status Bar ──
    hotReloadStatus = window.createStatusBarItem(StatusBarAlignment.Left, 98);
    hotReloadStatus.command = 'forja.toggleHotReload';
    hotReloadStatus.tooltip = 'Haz clic para activar/desactivar Hot Reload';
    context.subscriptions.push(hotReloadStatus);

    // ── Hot Reload on Save ──
    context.subscriptions.push(
        workspace.onDidSaveTextDocument(async (doc) => {
            if (doc.languageId === 'forja') {
                diagramProvider.updateActiveDiagram();
            }
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

    // ── Create Toolbar Status Bar Items ──
    for (const item of toolbarItems) {
        const sbi = window.createStatusBarItem(StatusBarAlignment.Left, item.priority);
        sbi.text = item.text;
        sbi.command = item.command;
        sbi.tooltip = item.tooltip;
        item.statusBarItem = sbi;
        context.subscriptions.push(sbi);
    }

    // ── Initial status bar update ──
    updateStatusBar();
    updateToolbarVisibility();

    outputChannel.appendLine('Forja Extension lista - todos los comandos registrados');
}

// ======================================================================
// Manual Syntax Highlighter via TextEditorDecorationType
// ======================================================================

const FORJA_KEYWORDS = [
    'importar', 'mut', 'si', 'sino',
    'mientras', 'para', 'repetir', 'funcion', 'fun', 'retornar', 'clase',
    'constructor', 'nuevo', 'prestado', 'tipo', 'coincidir', 'caso', 'BD',
    'externo', 'externa', 'hilo', 'canal', 'enviar', 'recibir', 'unir',
    'rasgo', 'implementa', 'donde', 'seleccionar', 'tiempo', 'otro',
    'requiere', 'asegura', 'siempre', 'resultado', 'anterior', 'continuar',
];

const FORJA_DECLARATIONS = ['variable', 'var', 'constante', 'const'];

const FORJA_TYPES = ['Entero', 'Decimal', 'Texto', 'Booleano', 'Nulo', 'Exacto'];
const FORJA_LITERALS = ['verdadero', 'falso', 'nulo'];
const FORJA_BUILTINS = [
    'escribir', 'leer', 'asegurar', 'longitud', 'aleatorio', 'redondear',
    'potencia', 'raiz', 'maximo', 'minimo', 'concatenar', 'insertar',
    'eliminar', 'contiene', 'claves', 'valores', 'a_caracter', 'a_texto',
    'a_entero', 'a_decimal', 'es_entero', 'es_texto', 'es_decimal',
    'es_booleano', 'es_lista', 'es_mapa', 'es_nulo', 'es_arreglo',
    'tiempo_actual', 'esperar', 'abrir_archivo', 'leer_archivo',
    'escribir_archivo', 'crear_directorio', 'existe_archivo', 'conectar',
    'consultar', 'ejecutar', 'cerrar', 'transaccion', 'guardar',
    'pedir_texto', 'imprimir', 'mayuscula',
];

interface DecoType { type: TextEditorDecorationType; ranges: Range[]; }
let decoTypes: Record<string, DecoType> = {};

function getDecoTypes(context: ExtensionContext): Record<string, DecoType> {
    if (Object.keys(decoTypes).length > 0) return decoTypes;

    const defs: Record<string, string> = {
        comment:    '#8B8B8B',
        string:     '#6AAB73',
        char:        '#6AAB73',
        number:     '#43A8D6',
        boolean:    '#3992D6',
        keyword:    '#CC7832',
        declaration: '#B27FB0',
        self:       '#B27FB0',
        type:       '#43A8D6',
        cls:        '#43A8D6',
        fn:         '#B5BC68',
        builtin:    '#B5BC68',
        operator:   '#BCBEC4',
        variable:   '#A9B7C6',
        punctuation:'#BCBEC4',
    };

    for (const [name, color] of Object.entries(defs)) {
        const t = window.createTextEditorDecorationType({ color });
        decoTypes[name] = { type: t, ranges: [] };
        context.subscriptions.push(t);
    }
    return decoTypes;
}

function tokenizeForja(text: string): { name: string; start: number; end: number }[] {
    const tokens: { name: string; start: number; end: number }[] = [];
    const len = text.length;
    let i = 0;

    const isWordChar = (c: string) => /[a-zA-Z0-9_ñ]/.test(c);
    const kwSet = new Set(FORJA_KEYWORDS);
    const declSet = new Set(FORJA_DECLARATIONS);
    const tySet = new Set(FORJA_TYPES);
    const litSet = new Set(FORJA_LITERALS);
    const biSet = new Set(FORJA_BUILTINS);

    while (i < len) {
        const c = text[i];

        // Comments: #, //, ///, /* */
        if (c === '#') {
            let end = text.indexOf('\n', i);
            if (end === -1) end = len;
            tokens.push({ name: 'comment', start: i, end });
            i = end;
            continue;
        }
        if (c === '/' && text[i + 1] === '/') {
            let end = text.indexOf('\n', i);
            if (end === -1) end = len;
            tokens.push({ name: 'comment', start: i, end });
            i = end;
            continue;
        }
        if (c === '/' && text[i + 1] === '*') {
            let end = text.indexOf('*/', i + 2);
            if (end === -1) end = len; else end += 2;
            tokens.push({ name: 'comment', start: i, end });
            i = end;
            continue;
        }

        // Strings: "..."
        if (c === '"') {
            let j = i + 1;
            while (j < len) {
                if (text[j] === '\\' && j + 1 < len) { j += 2; continue; }
                if (text[j] === '"') { j++; break; }
                j++;
            }
            tokens.push({ name: 'string', start: i, end: j });
            i = j;
            continue;
        }

        // Characters: '...'
        if (c === "'") {
            let j = i + 1;
            while (j < len) {
                if (text[j] === '\\' && j + 1 < len) { j += 2; continue; }
                if (text[j] === "'") { j++; break; }
                j++;
            }
            tokens.push({ name: 'char', start: i, end: j });
            i = j;
            continue;
        }

        // Numbers
        if (/\d/.test(c)) {
            let j = i + 1;
            while (j < len && /[\d.]/.test(text[j])) j++;
            tokens.push({ name: 'number', start: i, end: j });
            i = j;
            continue;
        }

        // Identifiers / keywords
        if (isWordChar(c) && /[a-zA-Z_ñ]/.test(c)) {
            let j = i + 1;
            while (j < len && isWordChar(text[j])) j++;
            const word = text.substring(i, j);

            if (word === 'este') {
                tokens.push({ name: 'self', start: i, end: j });
            } else if (declSet.has(word)) {
                tokens.push({ name: 'declaration', start: i, end: j });
            } else if (kwSet.has(word)) {
                tokens.push({ name: 'keyword', start: i, end: j });
            } else if (litSet.has(word)) {
                tokens.push({ name: 'boolean', start: i, end: j });
            } else if (tySet.has(word)) {
                tokens.push({ name: 'type', start: i, end: j });
            } else if (biSet.has(word)) {
                tokens.push({ name: 'builtin', start: i, end: j });
            } else if (/^[A-Z]/.test(word)) {
                tokens.push({ name: 'cls', start: i, end: j });
            } else if (text[j] === '(' || (text[j] === ' ' && text[j + 1] === '(')) {
                tokens.push({ name: 'fn', start: i, end: j });
            } else {
                tokens.push({ name: 'variable', start: i, end: j });
            }
            i = j;
            continue;
        }

        // Operators
        if (/[+\-*/%=<>!&|]/.test(c)) {
            let j = i;
            if (text[j] === '-' && text[j + 1] === '>') j += 2;
            else if (text[j] === ':' && text[j + 1] === ':') j += 2;
            else if (text[j] === '.' && text[j + 1] === '.' && text[j + 2] === '.') j += 3;
            else if ((c === '=' || c === '!' || c === '>' || c === '<' || c === '+' || c === '-' || c === '*' || c === '/' || c === '%' || c === '&' || c === '|') && text[j + 1] === '=') j += 2;
            else if (c === '|' && text[j + 1] === '|') j += 2;
            else if (c === '&' && text[j + 1] === '&') j += 2;
            else if (c === '+' && text[j + 1] === '+') j += 2;
            else if (c === '-' && text[j + 1] === '-') j += 2;
            else j += 1;
            tokens.push({ name: 'operator', start: i, end: j });
            i = j;
            continue;
        }

        // Punctuation
        if (/[{}()\[\];:,.@?]/.test(c)) {
            tokens.push({ name: 'punctuation', start: i, end: i + 1 });
            i++;
            continue;
        }

        i++;
    }

    return tokens;
}

function applyForjaDecorations(editor: TextEditor) {
    if (editor.document.languageId !== 'forja') return;
    const dt = getDecorations();

    for (const key of Object.keys(dt)) dt[key].ranges = [];

    const text = editor.document.getText();
    const tokens = tokenizeForja(text);

    for (const tok of tokens) {
        const d = dt[tok.name];
        if (!d) continue;
        const startPos = editor.document.positionAt(tok.start);
        const endPos = editor.document.positionAt(tok.end);
        d.ranges.push(new Range(startPos, endPos));
    }

    for (const key of Object.keys(dt)) {
        editor.setDecorations(dt[key].type, dt[key].ranges);
    }
}

function clearForjaDecorations(editor: TextEditor) {
    const dt = decoTypes;
    for (const key of Object.keys(dt)) {
        editor.setDecorations(dt[key].type, []);
    }
}

function getDecorations(): Record<string, DecoType> {
    return decoTypes;
}

function setupForjaHighlighter(context: ExtensionContext) {
    getDecoTypes(context);

    // Apply on open
    if (window.activeTextEditor) {
        applyForjaDecorations(window.activeTextEditor);
    }

    // Apply on editor switch
    context.subscriptions.push(
        window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                if (editor.document.languageId === 'forja') {
                    applyForjaDecorations(editor);
                } else {
                    clearForjaDecorations(editor);
                }
            }
        })
    );

    // Apply on text change (debounced)
    let debounceTimer: NodeJS.Timeout | undefined;
    context.subscriptions.push(
        workspace.onDidChangeTextDocument((event) => {
            const editor = window.activeTextEditor;
            if (!editor || editor.document !== event.document) return;
            if (editor.document.languageId !== 'forja') return;
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => applyForjaDecorations(editor), 100);
        })
    );
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

    let LanguageClient: any, TransportKind: any;
    try {
        const lsp = require('vscode-languageclient/node');
        LanguageClient = lsp.LanguageClient;
        TransportKind = lsp.TransportKind;
    } catch {
        outputChannel.appendLine('vscode-languageclient no disponible — LSP deshabilitado, highlighter sigue activo');
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
                    outputChannel.appendLine('forja-lsp no encontrado. LSP deshabilitado.');
                    return;
                }
            }
        }
    }

    const serverOptions = {
        run: { command: serverPath, transport: TransportKind.stdio },
        debug: { command: serverPath, transport: TransportKind.stdio },
    };

    const clientOptions = {
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

// ======================================================================
// Status Bar Toolbar (Android Studio / Flutter style)
// ======================================================================

interface ToolbarItem {
    id: string;
    text: string;
    command: string;
    tooltip: string;
    priority: number;
    statusBarItem?: StatusBarItem;
}

let toolbarItems: ToolbarItem[] = [
    { id: 'runFast', text: '$(zap) Ejecutar', command: 'forja.runFast', tooltip: 'Ejecutar con FastVM', priority: 105 },
    { id: 'runDebug', text: '$(bug) Debug', command: 'forja.runDebug', tooltip: 'Iniciar depuración (DAP)', priority: 104 },
    { id: 'hotReload', text: '$(sync) Reload', command: 'forja.hotReload', tooltip: 'Recarga en caliente (Hot Reload)', priority: 103 },
    { id: 'hotRestart', text: '$(refresh) Restart', command: 'forja.hotRestart', tooltip: 'Reinicio en caliente (Hot Restart)', priority: 102 },
    { id: 'runAOT', text: '$(tools) AOT', command: 'forja.runAOT', tooltip: 'Compilar AOT y ejecutar', priority: 101 },
    { id: 'buildAndroid', text: '$(device-mobile) Android', command: 'forja.buildAndroid', tooltip: 'Compilar para Android', priority: 100 },
];

function updateToolbarVisibility() {
    const editor = window.activeTextEditor;
    const isForja = editor && editor.document.languageId === 'forja';
    
    for (const item of toolbarItems) {
        if (item.statusBarItem) {
            if (isForja) {
                item.statusBarItem.show();
            } else {
                item.statusBarItem.hide();
            }
        }
    }
}

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



    const cmdOpenDiagram = commands.registerCommand('forja.openDiagram', () => {
        commands.executeCommand('workbench.view.extension.forja-sidebar');
    });
    context.subscriptions.push(cmdOpenDiagram);

    const cmdToggleSidebar = commands.registerCommand('forja.toggleSidebar', () => {
        commands.executeCommand('workbench.view.extension.forja-sidebar');
    });
    context.subscriptions.push(cmdToggleSidebar);

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
                'ADB no encontrado en PATH. Instala Android Platform Tools o agregalo la dirección en PATH.',
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
