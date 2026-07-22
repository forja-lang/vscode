# 🔥 Forja para Visual Studio Code

[![Version](https://img.shields.io/badge/version-0.8.8-007ACC?logo=visualstudiocode)](https://github.com/forja-lang/forja)
[![Marketplace](https://img.shields.io/badge/vscode-marketplace-007ACC?logo=visualstudiocode)](https://github.com/forja-lang/forja)
[![Licencia](https://img.shields.io/badge/license-MIT-green)](LICENSE.md)

Extensión oficial del lenguaje **Forja (fa)** para Visual Studio Code — un lenguaje de programación moderno, expresivo y multi-paradigma con sintaxis en español.

---

## ✨ Características

- **Resaltado de sintaxis** con gramática TextMate personalizada (todos los keywords, tipos, strings, operadores, etc.)
- **LSP (Language Server Protocol)** — análisis semántico, diagnóstico en tiempo real y autocompletado vía `forja-lsp`
- **Depurador integrado** — configuración de lanzamiento para depurar archivos `.fa` con breakpoints, inspección de variables y paso a paso
- **39 comandos** para ejecutar, compilar, transpilar, generar documentación y depurar código Forja
- **Snippets** para keywords, estructuras de control y tipos
- **Task provider** personalizado para builds (run, test, bench, fmt, doc, diagram, transpile, build-asm, build-wasm, build-android)
- **10 keybindings** para acceso rápido a las operaciones más frecuentes
- **Webviews** para diagramas AST interactivos, visor de bytecode y laboratorio WASM
- **Sidebar** dedicada con vista de diagramas
- **Recarga en caliente (Hot Reload)** automática al guardar archivos `.fa`
- **Compilación multi-target**: nativo, Android (ARM64, x86_64), WebAssembly
- **Paleta de colores coherente** con el CLI `forja highlight` y la documentación web
- Auto-cierre de brackets `{}`, `()`, `[]`, comillas `""` e indentación automática

---

## ⚡ Comandos Disponibles

| Comando | Título | Descripción |
|---------|--------|-------------|
| `forja.run` | Forja: ejecutar | Ejecuta el archivo activo con la VM por defecto |
| `forja.runFast` | Forja: ejecutar con FastVM | Ejecuta usando la máquina virtual rápida (FastVM) |
| `forja.runJIT` | Forja: ejecutar con JIT | Ejecuta con compilación JIT nativa |
| `forja.runAOT` | Forja: compilar AOT y ejecutar | Compila anticipadamente (AOT) y ejecuta |
| `forja.runDebug` | Forja: ejecutar en modo depuración | Ejecuta en modo debug con el depurador integrado |
| `forja.runGUI` | Forja: ejecutar con interfaz nativa | Ejecuta utilizando la runtime GUI nativa |
| `forja.runRepl` | Forja: abrir VM interactiva | Abre una terminal interactiva (REPL) de Forja |
| `forja.build` | Forja: compilar a Bytecode | Compila el archivo activo a bytecode |
| `forja.buildASM` | Forja: compilar a ASM | Compila a ensamblador |
| `forja.buildAndroid` | Forja: compilar para Android | Compila el proyecto para Android |
| `forja.buildAndroid.arm64` | Forja: compilar para Android ARM64 | Compila para arquitectura ARM64 Android |
| `forja.buildAndroid.x86_64` | Forja: compilar para Android x86_64 | Compila para arquitectura x86_64 Android |
| `forja.buildAndroid.all` | Forja: compilar para Android (todos los objetivos) | Compila para todas las arquitecturas Android |
| `forja.buildWASM` | Forja: compilar a WebAssembly | Compila el archivo activo a WebAssembly |
| `forja.test` | Forja: ejecutar prueba | Ejecuta las pruebas del archivo activo |
| `forja.bench` | Forja: evaluar rendimiento | Ejecuta benchmarks de rendimiento |
| `forja.fmt` | Forja: formatear archivo | Formatea el código Forja con el formateador oficial |
| `forja.doc` | Forja: generar documentacion HTML | Genera documentación HTML a partir del código |
| `forja.diagram` | Forja: generar diagrama | Genera un diagrama AST del código activo |
| `forja.transpile` | Forja: transpilar a Rust | Transpila el código Forja a Rust |
| `forja.hotReload` | Forja: recarga en caliente | Recarga el código en caliente sin reiniciar |
| `forja.hotRestart` | Forja: reinicio en caliente | Reinicia la ejecución en caliente |
| `forja.newProject` | Forja: crear nuevo proyecto | Crea un nuevo proyecto Forja desde una plantilla |
| `forja.selectVM` | Forja: seleccionar maquina virtual por omisión | Cambia la VM por defecto (FastVM, VM, JIT) |
| `forja.selectTarget` | Forja: seleccionar plataforma | Cambia la plataforma objetivo de compilación |
| `forja.showOutput` | Forja: mostrar salida | Muestra el panel de salida de Forja |
| `forja.installToolchain` | Forja: instalar o verificar el entorno de compilación | Verifica/instala el toolchain de Forja |
| `forja.openTutorial` | Forja: abrir tutorial interactivo | Abre el tutorial interactivo de Forja |
| `forja.openWasmPlayground` | Forja: abrir laboratorio WebAssembly | Abre el playground WASM en una webview |
| `forja.openDiagram` | Forja: abrir visor de diagramas | Abre el visor de diagramas AST |
| `forja.toggleSidebar` | Forja: alternar panel lateral | Muestra/oculta la sidebar de Forja |
| `forja.toggleHotReload` | Forja: activar o desactivar recarga en caliente | Activa/desactiva la recarga en caliente |
| `forja.checkAndroidNDK` | Forja: verificar NDK Android | Verifica que el NDK de Android esté instalado |
| `forja.deployAndroid` | Forja: desplegar en dispositivo Android | Despliega la app compilada en un dispositivo Android |
| `forja.showAST` | Forja: mostrar AST | Muestra el Árbol de Sintaxis Abstracta del archivo activo |
| `forja.showBytecode` | Forja: mostrar Bytecode generado | Muestra el bytecode generado por el compilador |
| `forja.openStdlib` | Forja: abrir archivo de la biblioteca | Abre un archivo de la biblioteca estándar |
| `forja.openFile` | Forja: abrir archivo | Abre un archivo del proyecto |
| `forja.revealLine` | Forja: ir a linea | Navega a una línea específica |

---

## ⚙️ Configuraciones

| Nombre | Tipo | Valor por defecto | Descripción |
|--------|------|-------------------|-------------|
| `forja.diagram.command` | `string` | `"forja"` | Comando o ruta absoluta al compilador Forja para generar diagramas |
| `forja.lsp.path` | `string` | `""` | Ruta al binario del LSP server `forja-lsp`. Vacío = auto-detect en PATH |
| `forja.lsp.enabled` | `boolean` | `true` | Habilitar/deshabilitar el servidor LSP |
| `forja.defaultVM` | `string` | `"fastvm"` | Máquina virtual por defecto para ejecución (`fastvm`, `vm`, `jit`) |
| `forja.defaultTarget` | `string` | `"native"` | Plataforma objetivo por defecto para compilación |
| `forja.buildArgs` | `string` | `""` | Argumentos extra para el compilador Forja (CLI) |
| `forja.terminal.preserveFocus` | `boolean` | `false` | Mantener el foco en el editor al ejecutar comandos |
| `forja.terminal.clearBeforeRun` | `boolean` | `false` | Limpiar la terminal antes de ejecutar |
| `forja.hotReload.enabled` | `boolean` | `true` | Habilitar recarga en caliente automática al guardar archivos `.fa` |
| `forja.checkDiagnosticsOnSave` | `boolean` | `true` | Ejecutar diagnóstico completo al guardar |

---

## ⌨️ Keybindings

| Tecla | Comando | Cuándo |
|-------|---------|--------|
| `Ctrl+Alt+R` | `forja.run` | `editorLangId == forja` |
| `Ctrl+Alt+F` | `forja.runFast` | `editorLangId == forja` |
| `Ctrl+Alt+D` | `forja.runDebug` | `editorLangId == forja` |
| `Ctrl+Alt+G` | `forja.runGUI` | `editorLangId == forja` |
| `Ctrl+Alt+T` | `forja.test` | `editorLangId == forja` |
| `Ctrl+Alt+P` | `forja.runRepl` | `editorLangId == forja` |
| `Ctrl+Alt+L` | `forja.fmt` | `editorLangId == forja` |
| `Ctrl+Alt+H` | `forja.hotReload` | `editorLangId == forja` |
| `Ctrl+Shift+R` | `forja.hotRestart` | `editorLangId == forja` |
| `Ctrl+Alt+E` | `forja.openTutorial` | `editorLangId == forja` |

---

## 🎨 Paleta de colores

| Token | Color | CSS/ANSI | Elementos |
|-------|-------|----------|-----------|
| `keyword` | `#f59e0b` 🔶 | `var(--fuego-light)` | `variable`, `si`, `funcion`, `clase`, `coincidir`, etc. |
| `function` | `#10b981` 🟢 | `var(--verde)` | `escribir()`, `leer()` |
| `type` | `#06b6d4` 🔷 | `var(--cian)` | `Entero`, `Decimal`, `Texto`, `Booleano` |
| `string` | `#fbbf24` ⭐ | gold | Texto entre comillas dobles |
| `comment` | `#5b6a84` 🌫️ | `var(--text-muted)` | Líneas con `//` |
| `operator` | `#ec4899` 🩷 | `var(--rosa)` | `+`, `-`, `*`, `/`, `==`, `&&`, `\|\|` |
| `number` | `#818cf8` 💜 | `var(--acero-light)` | Literales numéricos |
| `boolean` | `#f59e0b` 🔶 | `var(--fuego-light)` | `verdadero`, `falso` |

La paleta de colores de esta extensión es idéntica a la usada en el comando CLI `forja highlight`, la documentación web y el playground WASM.

---

## 🔧 Requisitos

- **Rust toolchain** (cargo, rustc) — necesario para compilar el núcleo de Forja
- **Forja** instalado en el sistema (`forja`, `forja-lsp` disponibles en PATH)
- VS Code `^1.60.0` o superior

---

## 📦 Instalación

### Desde VS Code Marketplace

1. Abrir VS Code
2. `Ctrl+Shift+P` → "Extensions: Install Extensions"
3. Buscar "Forja (fa)"
4. Hacer clic en "Instalar"

### Desde archivo VSIX

1. Descargar el `.vsix` desde [Releases](https://github.com/forja-lang/forja/releases)
2. `Ctrl+Shift+P` → "Extensions: Install from VSIX..."
3. Seleccionar el archivo `.vsix` descargado

### Desde terminal

```bash
code --install-extension forja-syntax-0.8.8.vsix
```

---

## 🚀 Uso rápido

1. Abre un archivo `.fa`
2. Usa `Ctrl+Shift+P` y busca "Forja: ejecutar"
3. O usa las teclas rápidas:
   - `Ctrl+Alt+R` — ejecutar con VM por defecto
   - `Ctrl+Alt+F` — ejecutar con FastVM
   - `Ctrl+Alt+D` — ejecutar en modo depuración
4. Para cambiar de motor, usa `Forja: seleccionar maquina virtual por omisión`

---

## 📁 Estructura del repositorio

| Ruta | Propósito |
|------|-----------|
| `vscode/forja-syntax/` | Código fuente de la extensión |
| `vscode/forja-syntax/package.json` | Manifiesto de la extensión |
| `vscode/forja-syntax/language-configuration.json` | Configuración de comentarios, brackets, auto-cierre, indentación |
| `vscode/forja-syntax/syntaxes/forja.tmLanguage.json` | Gramática TextMate |
| `vscode/forja-syntax/src/` | Código TypeScript de la extensión |
| `vscode/forja-syntax/snippets/forja.json` | Snippets del lenguaje |
| `.github/workflows/package.yml` | CI: empaquetado automático del VSIX |

---

## 🤝 Contribuir

```bash
git clone https://github.com/forja-lang/forja.git
cd vscode/forja-syntax
npm install
```

Para desarrollo:

1. Abrí la carpeta `vscode/forja-syntax/` en VS Code
2. Presioná `F5` para iniciar una ventana de Extension Development Host
3. Editá los archivos en `syntaxes/`, `src/` o `language-configuration.json`
4. Recargá con `Ctrl+Shift+P` → "Developer: Reload Window"
5. Compilá con `npm run compile`
6. Opcional: regenerá el VSIX con `npx vsce package`

---

## 📝 Notas de versión

**Versión actual: 0.8.8** — Soporte completo para el lenguaje Forja: sintaxis, LSP, compilación, depuración y toolchain multi-plataforma.

---

## 📄 Licencia

MIT — Ver archivo [LICENSE.md](LICENSE.md) para más detalles.
