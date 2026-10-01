# Centro de Mando Pospago · actualización automática

Lee `ARCHIVOS GB\BASE`, recalcula todo y publica la página en **https://ecortesgb.github.io/grupobenber/pospago/**
(GitHub Pages, carpeta `docs/pospago/`), de lunes a viernes a las 6:00 pm.

**El repo es público**, por eso la página se publica **cifrada con contraseña** (AES-GCM). Sin la clave solo se ve una pantalla de acceso.

## Instalar (lo hace Claude Code)
En Claude Code, dentro de este repo, escribe: **`instala el centro de mando pospago`**
(usa la skill `.claude/skills/centro-mando-pospago`). Solo te pedirá la clave de acceso.

## Instalar a mano
1. `instalar_dependencias.bat`
2. Copia `config.ejemplo.json` → `config.json` y pon tu clave (el archivo está en `.gitignore`).
3. `py -3 build_centro_mando.py` → revisa `salida\index_abierto.html` (sin clave, solo local).
4. `py -3 build_centro_mando.py --deploy` → publica.
5. Clic derecho en `instalar_tarea_18h.ps1` → Ejecutar con PowerShell (tarea L-V 6:00 pm).

## Qué lee
`ALTAS\Pospago\Mensual\*.xlsx` (POSPAGO) · `REGISTROS\Semanal\2026\26-Sxx.csv` · `REGISTROS TELEFONICA\Pospago\26-Sxx.xlsx` ·
`VINCULACION\MM_2026.xlsx` · `CUOTAS\Benber\MM_2026.xlsx` (CAPILARIDAD) · `ESTRUCTURAS\Base Nueva Estructura.xlsx` (Estructura Actual)

## Protecciones
- No publica si altas, facturas o DN caen >15% vs la corrida anterior (`salida\estado.json`).
- Omite cuotas que sean copia de otro mes.
- Registro de cada corrida: `salida\log.txt`.
