// Forja Diagram Viewer — Webview v0.7.0
// Arbol AST interactivo, diagrama de flujo, mapa de dependencias con zoom y pan

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

export class ForjaDiagramProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'forja.diagram';
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        // Escuchar mensajes desde la webview (por ejemplo, para exportar)
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case 'exportSvg': {
                    const svgContent = msg.svg;
                    const uri = await vscode.window.showSaveDialog({
                        filters: { 'SVG Image': ['svg'] },
                        defaultUri: vscode.Uri.file('diagrama.svg'),
                    });
                    if (uri) {
                        fs.writeFileSync(uri.fsPath, svgContent, 'utf-8');
                        vscode.window.showInformationMessage(`Diagrama guardado: ${uri.fsPath}`);
                    }
                    break;
                }
            }
        });

        // Actualizar diagrama inicialmente
        this.updateActiveDiagram();
    }

    public async updateActiveDiagram() {
        if (!this._view) return;

        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'forja') {
            this._view.webview.html = this._getEmptyStateHtml("Abre un archivo Forja (.fa) para ver su diagrama");
            return;
        }

        const source = editor.document.getText();
        if (!source.trim()) {
            this._view.webview.html = this._getEmptyStateHtml("El archivo Forja actual está vacío");
            return;
        }

        await this._generateDiagram(source);
    }

    private async _generateDiagram(source: string) {
        if (!this._view) return;

        const cmd = vscode.workspace.getConfiguration('forja').get<string>('diagram.command', 'forja');

        // Rutas temporales para la generación del diagrama
        const extensionDir = path.join(this._extensionUri.fsPath);
        const tmpFile = path.join(extensionDir, '.diagram_temp.fa');
        const htmlFile = path.join(extensionDir, '.diagram_temp.html');

        try {
            fs.writeFileSync(tmpFile, source, 'utf-8');

            const child = spawn(cmd, ['diagram', tmpFile, '-o', htmlFile], {
                windowsHide: true,
                shell: true,
            });

            let err = '';
            child.stderr?.on('data', (data: Buffer) => {
                err += data.toString();
            });

            child.on('close', (code) => {
                // Eliminar archivo .fa temporal
                try { fs.unlinkSync(tmpFile); } catch {}

                if (code === 0 && fs.existsSync(htmlFile)) {
                    let htmlContent = fs.readFileSync(htmlFile, 'utf-8');
                    
                    // Eliminar el archivo HTML generado temporalmente
                    try { fs.unlinkSync(htmlFile); } catch {}

                    // Inyectar funcionalidad de Pan & Zoom y estilos premium en el HTML
                    this._view!.webview.html = this._injectPanZoom(htmlContent);
                } else {
                    this._view!.webview.html = this._getEmptyStateHtml(`Error al generar diagrama: ${err || 'Proceso falló'}`);
                }
            });
        } catch (e: any) {
            this._view.webview.html = this._getEmptyStateHtml(`Error: ${e.message}`);
        }
    }

    private _injectPanZoom(html: string): string {
        const styleOverride = `
<style>
    /* Estilos Premium y soporte para Zoom y Paneo */
    body {
        margin: 0;
        padding: 10px;
        height: 100vh;
        overflow: hidden;
        background: #0d1117;
        font-family: system-ui, -apple-system, sans-serif;
    }
    .hd {
        margin-bottom: 12px;
        padding: 8px 12px;
        background: #161b22;
        border-radius: 6px;
        border: 1px solid #30363d;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: nowrap;
    }
    .hd h1 {
        font-size: 1.05em;
        margin-right: auto;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .stats {
        font-size: 0.8em;
        color: #8b949e;
        margin-right: 10px;
    }
    button {
        background: #21262d;
        color: #c9d1d9;
        border: 1px solid #30363d;
        padding: 4px 10px;
        border-radius: 6px;
        cursor: pointer;
        font-size: .8em;
        white-space: nowrap;
        transition: background 0.2s, border-color 0.2s;
    }
    button:hover {
        background: #30363d;
        border-color: #8b949e;
    }
    button.a {
        background: #1f6feb;
        border-color: #388bfd;
    }
    
    #va, #vf {
        position: relative;
        overflow: hidden !important;
        height: calc(100vh - 75px) !important;
        border-radius: 8px;
        border: 1px solid #30363d;
        background: #161b22;
    }

    /* Ocultar scrollbars nativas de los contenedores para usar drag */
    .v {
        overflow: hidden !important;
    }

    /* Animaciones suaves para transiciones de zoom */
    .zoom-wrapper {
        position: absolute;
        transform-origin: 0 0;
        cursor: grab;
        user-select: none;
        width: max-content;
        height: max-content;
        min-width: 100%;
        min-height: 100%;
        padding: 30px;
        box-sizing: border-box;
    }
    .zoom-wrapper:active {
        cursor: grabbing;
    }
</style>
`;

        const scriptPanZoom = `
<script>
    // Configuración nativa de Pan & Zoom para los diagramas de Forja
    function initPanZoom(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        // Crear contenedor interno de zoom
        const wrapper = document.createElement('div');
        wrapper.className = 'zoom-wrapper';
        
        // Mover todos los elementos hijos originales al wrapper
        while (container.firstChild) {
            wrapper.appendChild(container.firstChild);
        }
        container.appendChild(wrapper);

        let scale = 1.0;
        let translateX = 10;
        let translateY = 10;
        let isDragging = false;
        let startX = 0;
        let startY = 0;

        const updateTransform = () => {
            wrapper.style.transform = \`translate(\${translateX}px, \${translateY}px) scale(\${scale})\`;
        };

        // Centrado inicial
        updateTransform();

        // Control del zoom mediante la rueda del ratón
        container.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = 1.08;
            const rect = container.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            // Posición del cursor relativa al contenido antes del zoom
            const contentX = (mouseX - translateX) / scale;
            const contentY = (mouseY - translateY) / scale;

            if (e.deltaY < 0) {
                scale = Math.min(scale * zoomFactor, 8.0);
            } else {
                scale = Math.max(scale / zoomFactor, 0.25);
            }

            // Reposicionar para centrar zoom en el cursor
            translateX = mouseX - contentX * scale;
            translateY = mouseY - contentY * scale;

            updateTransform();
        }, { passive: false });

        // Arrastrar (Paneo)
        container.addEventListener('mousedown', (e) => {
            // Solo botón izquierdo del ratón
            if (e.button !== 0) return;
            isDragging = true;
            startX = e.clientX - translateX;
            startY = e.clientY - translateY;
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            translateX = e.clientX - startX;
            translateY = e.clientY - startY;
            updateTransform();
        });

        window.addEventListener('mouseup', () => {
            isDragging = false;
        });

        // Resetear con doble clic
        container.addEventListener('dblclick', () => {
            scale = 1.0;
            translateX = 10;
            translateY = 10;
            updateTransform();
        });
    }

    // Inicializar pan y zoom en ambos diagramas
    setTimeout(() => {
        initPanZoom('va');
        initPanZoom('vf');
    }, 100);
</script>
`;

        // Insertar estilos justo antes de </head>
        let updatedHtml = html.replace('</head>', `${styleOverride}</head>`);
        
        // Insertar script de zoom justo antes de </body>
        updatedHtml = updatedHtml.replace('</body>', `${scriptPanZoom}</body>`);

        return updatedHtml;
    }

    private _getEmptyStateHtml(message: string): string {
        return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
    body {
        font-family: system-ui, -apple-system, sans-serif;
        background: #0d1117;
        color: #8b949e;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100vh;
        margin: 0;
        padding: 20px;
        text-align: center;
    }
    .icon {
        font-size: 40px;
        margin-bottom: 12px;
        color: #30363d;
    }
    .msg {
        font-size: 13px;
        max-width: 250px;
        line-height: 1.4;
    }
</style>
</head>
<body>
    <div class="icon">📊</div>
    <div class="msg">${message}</div>
</body>
</html>`;
    }
}
