// Forja VSCode Extension — Tree View Providers (Fase 7.2)
// Project Outline, Forja Examples, Stdlib Browser

import * as path from 'path';
import * as fs from 'fs';
import {
    EventEmitter,
    Event,
    TreeDataProvider,
    TreeItem,
    TreeItemCollapsibleState,
    Uri,
    window,
    workspace,
    ExtensionContext,
    Command,
    ThemeIcon,
} from 'vscode';

// ======================================================================
// Shared types
// ======================================================================

export interface ForjaTreeItem extends TreeItem {
    filePath?: string;
    children?: ForjaTreeItem[];
}

// ======================================================================
// Forja Examples Provider
// ======================================================================

export class ForjaExamplesProvider implements TreeDataProvider<ForjaTreeItem> {
    private _onDidChangeTreeData = new EventEmitter<ForjaTreeItem | undefined>();
    readonly onDidChangeTreeData: Event<ForjaTreeItem | undefined> = this._onDidChangeTreeData.event;

    private examplesRoot: string;

    constructor(private context: ExtensionContext) {
        // Resolve examples directory from extension root
        this.examplesRoot = path.join(context.extensionPath, '..', '..', '..', 'examples', 'examples');
        // Fallback: try relative to workspace
        if (!fs.existsSync(this.examplesRoot)) {
            const wsFolders = workspace.workspaceFolders;
            if (wsFolders && wsFolders.length > 0) {
                this.examplesRoot = path.join(wsFolders[0].uri.fsPath, 'examples', 'examples');
            }
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: ForjaTreeItem): TreeItem {
        return element;
    }

    async getChildren(element?: ForjaTreeItem): Promise<ForjaTreeItem[]> {
        if (element) {
            // Return children of a category folder
            return element.children || [];
        }

        // Root level: scan examples directory
        if (!fs.existsSync(this.examplesRoot)) {
            return [{
                label: 'No se encontraron ejemplos',
                collapsibleState: TreeItemCollapsibleState.None,
                tooltip: 'Ruta buscada: ' + this.examplesRoot,
            }];
        }

        return this.buildCategoryTree();
    }

    private buildCategoryTree(): ForjaTreeItem[] {
        const categories: Map<string, ForjaTreeItem[]> = new Map();

        try {
            const files = fs.readdirSync(this.examplesRoot);
            for (const file of files) {
                if (!file.endsWith('.fa')) continue;

                const filePath = path.join(this.examplesRoot, file);
                const stat = fs.statSync(filePath);
                if (!stat.isFile()) continue;

                // Parse category from filename prefix
                const match = file.match(/^(\d+)_(.+)\.fa$/);
                let category: string;
                let label: string;

                if (match) {
                    const num = parseInt(match[1], 10);
                    label = match[2].replace(/_/g, ' ');

                    if (num >= 300) category = 'GUI Nativa';
                    else if (num >= 200) category = 'Avanzados';
                    else if (num >= 150) category = 'Algoritmos';
                    else if (num >= 125) category = 'Atributos & Hilos';
                    else if (num >= 111) category = 'Match & Select';
                    else if (num >= 100) category = 'Genericos';
                    else if (num >= 90) category = 'Rasgos';
                    else if (num >= 80) category = 'Result/Option';
                    else if (num >= 70) category = 'Concurrencia';
                    else if (num >= 60) category = 'Clases & Objetos';
                    else category = 'Basicos';
                } else {
                    label = file.replace('.fa', '').replace(/_/g, ' ');
                    category = 'Otros';
                }

                const item: ForjaTreeItem = {
                    label: `${label}`,
                    collapsibleState: TreeItemCollapsibleState.None,
                    filePath: filePath,
                    command: {
                        command: 'forja.openFile',
                        title: 'Abrir archivo',
                        arguments: [Uri.file(filePath)],
                    } as Command,
                    tooltip: filePath,
                };

                if (!categories.has(category)) {
                    categories.set(category, []);
                }
                categories.get(category)!.push(item);
            }
        } catch (e) {
            // Silently handle errors
        }

        // Build tree items for each category
        const result: ForjaTreeItem[] = [];
        // Sort categories in a meaningful order
        const categoryOrder = [
            'Basicos', 'Clases & Objetos', 'Concurrencia',
            'Rasgos', 'Genericos', 'Match & Select',
            'Result/Option', 'Atributos & Hilos', 'Algoritmos',
            'Avanzados', 'GUI Nativa', 'Otros',
        ];

        for (const catName of categoryOrder) {
            const items = categories.get(catName);
            if (items) {
                result.push({
                    label: catName,
                    collapsibleState: TreeItemCollapsibleState.Collapsed,
                    children: items.sort((a, b) => (a.label?.toString() || '').localeCompare(b.label?.toString() || '')),
                });
            }
        }

        // Any remaining categories
        for (const [catName, items] of categories) {
            if (!categoryOrder.includes(catName)) {
                result.push({
                    label: catName,
                    collapsibleState: TreeItemCollapsibleState.Collapsed,
                    children: items,
                });
            }
        }

        return result;
    }
}

// ======================================================================
// Stdlib Browser Provider
// ======================================================================

export class StdlibBrowserProvider implements TreeDataProvider<ForjaTreeItem> {
    private _onDidChangeTreeData = new EventEmitter<ForjaTreeItem | undefined>();
    readonly onDidChangeTreeData: Event<ForjaTreeItem | undefined> = this._onDidChangeTreeData.event;

    private stdlibRoot: string;

    constructor(private context: ExtensionContext) {
        this.stdlibRoot = path.join(context.extensionPath, '..', '..', '..', 'stdlib');
        if (!fs.existsSync(this.stdlibRoot)) {
            const wsFolders = workspace.workspaceFolders;
            if (wsFolders && wsFolders.length > 0) {
                this.stdlibRoot = path.join(wsFolders[0].uri.fsPath, 'stdlib');
            }
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: ForjaTreeItem): TreeItem {
        return element;
    }

    async getChildren(element?: ForjaTreeItem): Promise<ForjaTreeItem[]> {
        if (element && element.children) {
            return element.children;
        }

        if (!element) {
            // Root — scan stdlib directory
            return this.scanStdlibDir(this.stdlibRoot);
        }

        return [];
    }

    private scanStdlibDir(dirPath: string, relativePath = ''): ForjaTreeItem[] {
        if (!fs.existsSync(dirPath)) {
            return [{
                label: 'Stdlib no encontrada',
                collapsibleState: TreeItemCollapsibleState.None,
                tooltip: 'Ruta: ' + dirPath,
            }];
        }

        const items: ForjaTreeItem[] = [];

        try {
            const entries = fs.readdirSync(dirPath).sort();
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry);
                const stat = fs.statSync(fullPath);
                const childRelative = relativePath ? `${relativePath}/${entry}` : entry;

                if (stat.isDirectory()) {
                    const children = this.scanStdlibDir(fullPath, childRelative);
                    items.push({
                        label: `${entry}`,
                        collapsibleState: children.length > 0
                            ? TreeItemCollapsibleState.Collapsed
                            : TreeItemCollapsibleState.None,
                        children,
                        tooltip: fullPath,
                    });
                } else if (entry.endsWith('.fa')) {
                    const label = entry.replace('.fa', '');
                    items.push({
                        label: `${label}`,
                        collapsibleState: TreeItemCollapsibleState.None,
                        filePath: fullPath,
                        command: {
                            command: 'forja.openFile',
                            title: 'Abrir archivo',
                            arguments: [Uri.file(fullPath)],
                        } as Command,
                        tooltip: fullPath,
                    });
                }
            }
        } catch {
            // Ignore errors
        }

        return items;
    }
}

// ======================================================================
// Project Outline Provider (Simple symbol-based)
// ======================================================================

interface SymbolEntry {
    name: string;
    kind: 'function' | 'class' | 'variable' | 'constante' | 'tipo' | 'test';
    line: number;
    filePath?: string;
    references?: { line: number; text: string }[];
}

export class ProjectOutlineProvider implements TreeDataProvider<ForjaTreeItem> {
    private _onDidChangeTreeData = new EventEmitter<ForjaTreeItem | undefined>();
    readonly onDidChangeTreeData: Event<ForjaTreeItem | undefined> = this._onDidChangeTreeData.event;

    private symbols: SymbolEntry[] = [];
    private currentFilePath: string | undefined;

    refresh(): void {
        this.parseActiveDocument();
        this._onDidChangeTreeData.fire(undefined);
    }

    private parseActiveDocument(): void {
        const editor = window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'forja') {
            this.symbols = [];
            this.currentFilePath = undefined;
            return;
        }

        this.currentFilePath = editor.document.fileName;
        const text = editor.document.getText();
        this.symbols = this.extractSymbols(text);
    }

    private extractSymbols(source: string): SymbolEntry[] {
        const symbols: SymbolEntry[] = [];
        const lines = source.split('\n');

        // Regex patterns for symbol declarations
        const patterns: { regex: RegExp; kind: SymbolEntry['kind'] }[] = [
            { regex: /^funcion\s+(\w+)/, kind: 'function' },
            { regex: /^clase\s+(\w+)/, kind: 'class' },
            { regex: /^tipo\s+(\w+)/, kind: 'tipo' },
            { regex: /^variable\s+(\w+)/, kind: 'variable' },
            { regex: /^constante\s+(\w+)/, kind: 'constante' },
            { regex: /^@test\s*$/, kind: 'test' },
        ];

        let inTest = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Track @test annotation
            if (/^\s*@test/.test(line)) {
                inTest = true;
                continue;
            }

            for (const { regex, kind } of patterns) {
                const match = line.match(regex);
                if (match) {
                    symbols.push({
                        name: kind === 'test' ? `@test ${match[1] || 'unnamed'}` : match[1],
                        kind: inTest && kind === 'function' ? 'test' : kind,
                        line: i + 1,
                        filePath: this.currentFilePath,
                        references: [],
                    });
                    inTest = false;
                    break;
                }
            }
        }

        // Find references for variables and constants: look for usage after declaration
        for (const sym of symbols) {
            if (sym.kind !== 'variable' && sym.kind !== 'constante') continue;
            const refs: { line: number; text: string }[] = [];
            const varName = sym.name;
            // Search lines after declaration for non-declaration usage
            for (let i = sym.line; i < lines.length; i++) {
                const line = lines[i];
                // Skip declaration line itself
                if (i === sym.line - 1) continue;
                // Skip lines that are comments
                if (line.trimStart().startsWith('//')) continue;
                // Look for the variable name as a whole word, not in declarations
                const declPattern = new RegExp(`^(variable|constante|funcion|clase|tipo)\\s+${varName}\\b`);
                if (declPattern.test(line.trim())) continue;
                // Match whole-word usage (not part of longer identifier)
                const useRegex = new RegExp(`\\b${varName}\\b`);
                if (useRegex.test(line)) {
                    refs.push({ line: i + 1, text: line.trim().substring(0, 60) });
                }
            }
            sym.references = refs;
        }

        return symbols;
    }

    getTreeItem(element: ForjaTreeItem): TreeItem {
        return element;
    }

    async getChildren(element?: ForjaTreeItem): Promise<ForjaTreeItem[]> {
        if (element) {
            return element.children || [];
        }

        // Refresh on each getChildren to stay in sync
        this.parseActiveDocument();

        if (this.symbols.length === 0) {
            const editor = window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'forja') {
                return [{
                    label: 'Abre un archivo .fa para ver su estructura',
                    collapsibleState: TreeItemCollapsibleState.None,
                }];
            }
            return [{
                label: 'Sin simbolos encontrados',
                collapsibleState: TreeItemCollapsibleState.None,
            }];
        }

        // Group by kind
        const groups: Map<string, ForjaTreeItem[]> = new Map();

        for (const sym of this.symbols) {
            const groupLabel = this.kindToLabel(sym.kind);
            const uri = sym.filePath ? Uri.file(sym.filePath) : undefined;

            // Build children: for variables/constantes, include reference lines
            const children: ForjaTreeItem[] = [];
            if (sym.references && sym.references.length > 0 && (sym.kind === 'variable' || sym.kind === 'constante')) {
                for (const ref of sym.references) {
                    children.push({
                        label: `L${ref.line}: ${ref.text}`,
                        collapsibleState: TreeItemCollapsibleState.None,
                        tooltip: `Referencia en linea ${ref.line}`,
                        command: uri ? {
                            command: 'forja.revealLine',
                            title: 'Ir a línea',
                            arguments: [uri, ref.line],
                        } : undefined,
                    });
                }
            }

            const item: ForjaTreeItem = {
                label: sym.name,
                collapsibleState: children.length > 0
                    ? TreeItemCollapsibleState.Collapsed
                    : TreeItemCollapsibleState.None,
                children: children.length > 0 ? children : undefined,
                tooltip: `${this.kindToLabel(sym.kind)} — linea ${sym.line}${sym.references && sym.references.length > 0 ? `, ${sym.references.length} referencia(s)` : ''}`,
                command: uri ? {
                    command: 'forja.revealLine',
                    title: 'Ir a línea',
                    arguments: [uri, sym.line],
                } : undefined,
            };

            if (!groups.has(groupLabel)) {
                groups.set(groupLabel, []);
            }
            groups.get(groupLabel)!.push(item);
        }

        const result: ForjaTreeItem[] = [];
        const groupOrder = ['Tests', 'Funciones', 'Clases', 'Tipos', 'Variables', 'Constantes'];

        for (const groupName of groupOrder) {
            const items = groups.get(groupName);
            if (items) {
                result.push({
                    label: `${groupName} (${items.length})`,
                    collapsibleState: TreeItemCollapsibleState.Collapsed,
                    children: items,
                });
            }
        }

        return result;
    }

    private kindToLabel(kind: SymbolEntry['kind']): string {
        switch (kind) {
            case 'function': return 'Funciones';
            case 'test': return 'Tests';
            case 'class': return 'Clases';
            case 'tipo': return 'Tipos';
            case 'variable': return 'Variables';
            case 'constante': return 'Constantes';
        }
    }

    private kindToIcon(_kind: SymbolEntry['kind']): undefined {
        return undefined;
    }
}

// ======================================================================
// Forja Control Panel / DevTools Provider
// ======================================================================

export class ForjaDevToolsProvider implements TreeDataProvider<ForjaTreeItem> {
    private _onDidChangeTreeData = new EventEmitter<ForjaTreeItem | undefined>();
    readonly onDidChangeTreeData: Event<ForjaTreeItem | undefined> = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: ForjaTreeItem): TreeItem {
        return element;
    }

    async getChildren(element?: ForjaTreeItem): Promise<ForjaTreeItem[]> {
        if (!element) {
            // Root categories
            return [
                {
                    label: 'Ejecución y Depuración',
                    collapsibleState: TreeItemCollapsibleState.Expanded,
                    iconPath: new ThemeIcon('run-all'),
                    children: [
                        {
                            label: 'Ejecutar (VM clásica)',
                            collapsibleState: TreeItemCollapsibleState.None,
                            iconPath: new ThemeIcon('play'),
                            command: { command: 'forja.run', title: 'Ejecutar VM' }
                        },
                        {
                            label: 'Ejecutar con FastVM (Rápida)',
                            collapsibleState: TreeItemCollapsibleState.None,
                            iconPath: new ThemeIcon('zap'),
                            command: { command: 'forja.runFast', title: 'Ejecutar FastVM' }
                        },
                        {
                            label: 'Ejecutar con JIT',
                            collapsibleState: TreeItemCollapsibleState.None,
                            iconPath: new ThemeIcon('rocket'),
                            command: { command: 'forja.runJIT', title: 'Ejecutar JIT' }
                        },
                        {
                            label: 'Compilar AOT y ejecutar',
                            collapsibleState: TreeItemCollapsibleState.None,
                            iconPath: new ThemeIcon('tools'),
                            command: { command: 'forja.runAOT', title: 'Ejecutar AOT' }
                        },
                        {
                            label: 'Iniciar Depuración (DAP)',
                            collapsibleState: TreeItemCollapsibleState.None,
                            iconPath: new ThemeIcon('bug'),
                            command: { command: 'forja.runDebug', title: 'Iniciar Debug' }
                        },
                        {
                            label: 'Ejecutar con Interfaz Nativa (GUI)',
                            collapsibleState: TreeItemCollapsibleState.None,
                            iconPath: new ThemeIcon('window'),
                            command: { command: 'forja.runGUI', title: 'Ejecutar GUI' }
                        },
                        {
                            label: 'Abrir REPL',
                            collapsibleState: TreeItemCollapsibleState.None,
                            iconPath: new ThemeIcon('terminal'),
                            command: { command: 'forja.runRepl', title: 'Abrir REPL' }
                        }
                    ]
                },
                {
                    label: 'Desarrollo en Caliente',
                    collapsibleState: TreeItemCollapsibleState.Expanded,
                    iconPath: new ThemeIcon('sync'),
                    children: [
                        {
                            label: 'Hot Reload (Recarga rápida)',
                            collapsibleState: TreeItemCollapsibleState.None,
                            iconPath: new ThemeIcon('sync'),
                            command: { command: 'forja.hotReload', title: 'Hot Reload' }
                        },
                        {
                            label: 'Hot Restart (Reinicio rápido)',
                            collapsibleState: TreeItemCollapsibleState.None,
                            iconPath: new ThemeIcon('refresh'),
                            command: { command: 'forja.hotRestart', title: 'Hot Restart' }
                        },
                        {
                            label: 'Activar/Desactivar Auto-Reload',
                            collapsibleState: TreeItemCollapsibleState.None,
                            iconPath: new ThemeIcon('circle-slash'),
                            command: { command: 'forja.toggleHotReload', title: 'Toggle Hot Reload' }
                        }
                    ]
                },
                {
                    label: 'Compilación y Despliegue',
                    collapsibleState: TreeItemCollapsibleState.Collapsed,
                    iconPath: new ThemeIcon('package'),
                    children: [
                        {
                            label: 'Compilar a Bytecode',
                            collapsibleState: TreeItemCollapsibleState.None,
                            iconPath: new ThemeIcon('gear'),
                            command: { command: 'forja.build', title: 'Compilar Bytecode' }
                        },
                        {
                            label: 'Compilar a código ASM (Nativo)',
                            collapsibleState: TreeItemCollapsibleState.None,
                            iconPath: new ThemeIcon('chip'),
                            command: { command: 'forja.buildASM', title: 'Compilar ASM' }
                        },
                        {
                            label: 'Compilar a WebAssembly (WASM)',
                            collapsibleState: TreeItemCollapsibleState.None,
                            iconPath: new ThemeIcon('globe'),
                            command: { command: 'forja.buildWASM', title: 'Compilar WASM' }
                        },
                        {
                            label: 'Compilar para Android (ARM64)',
                            collapsibleState: TreeItemCollapsibleState.None,
                            iconPath: new ThemeIcon('device-mobile'),
                            command: { command: 'forja.buildAndroid', title: 'Compilar Android' }
                        },
                        {
                            label: 'Desplegar en Android (ADB)',
                            collapsibleState: TreeItemCollapsibleState.None,
                            iconPath: new ThemeIcon('plug'),
                            command: { command: 'forja.deployAndroid', title: 'Desplegar Android' }
                        }
                    ]
                },
                {
                    label: 'Herramientas de Análisis',
                    collapsibleState: TreeItemCollapsibleState.Collapsed,
                    iconPath: new ThemeIcon('beaker'),
                    children: [
                        {
                            label: 'Ejecutar Pruebas (Test)',
                            collapsibleState: TreeItemCollapsibleState.None,
                            iconPath: new ThemeIcon('beaker'),
                            command: { command: 'forja.test', title: 'Ejecutar Tests' }
                        },
                        {
                            label: 'Evaluar Rendimiento (Bench)',
                            collapsibleState: TreeItemCollapsibleState.None,
                            iconPath: new ThemeIcon('dashboard'),
                            command: { command: 'forja.bench', title: 'Evaluar Rendimiento' }
                        },
                        {
                            label: 'Formatear Código',
                            collapsibleState: TreeItemCollapsibleState.None,
                            iconPath: new ThemeIcon('paintcan'),
                            command: { command: 'forja.fmt', title: 'Formatear Código' }
                        },
                        {
                            label: 'Mostrar AST',
                            collapsibleState: TreeItemCollapsibleState.None,
                            iconPath: new ThemeIcon('symbol-struct'),
                            command: { command: 'forja.showAST', title: 'Mostrar AST' }
                        },
                        {
                            label: 'Mostrar Bytecode',
                            collapsibleState: TreeItemCollapsibleState.None,
                            iconPath: new ThemeIcon('symbol-ruler'),
                            command: { command: 'forja.showBytecode', title: 'Mostrar Bytecode' }
                        }
                    ]
                }
            ];
        }
        return element.children || [];
    }
}
