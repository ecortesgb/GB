---
name: centro-mando-pospago
description: Instala, actualiza o da mantenimiento al Centro de Mando Pospago de Grupo Benber (genera la página desde ARCHIVOS GB\BASE, la publica cifrada en GitHub Pages /pospago/ y programa la tarea L-V 6:00 pm). Úsala cuando Elías diga "instala/actualiza/arregla el centro de mando pospago".
---

# Centro de Mando Pospago — instalación y mantenimiento

Código en `centro-mando-pospago/` de este repo. Publica en `docs/pospago/index.html` → https://ecortesgb.github.io/grupobenber/pospago/
Elías habla español y quiere respuestas cortas, con archivos completos y listos; pregunta antes de tocar algo que ya funciona.

## Instalar (Windows, PC de Elías)
1. `py -3 --version`; luego `py -3 -m pip install -r centro-mando-pospago/requirements.txt`.
2. Verifica que existe `C:\Users\ecort\OneDrive - Grupo Benber\ARCHIVOS GB\BASE` (si no, pregunta la ruta y ponla en `"root"`).
3. **Pide a Elías la clave de acceso** (no la inventes ni la muestres de vuelta). Crea `centro-mando-pospago/config.json` desde `config.ejemplo.json`. Ese archivo está en `.gitignore`: **nunca lo subas**.
4. Genera sin publicar: `py -3 build_centro_mando.py` (≈75 s). Revisa en el log: cuotas usadas, corte de pagos, altas (~2,500+), facturas, sin errores.
5. Publica: `py -3 build_centro_mando.py --deploy` (copia a `docs/pospago/`, commit y push). Confirma que GitHub Pages sirve `main` carpeta `/docs`; el enlace tarda 1–2 min.
6. Actualización MANUAL (decisión de Elías: la info no llega diario). Icono del escritorio "Actualizar Centro de Mando" → `centro-mando-pospago\actualizar_ahora.bat` (pull, genera, publica y muestra el resultado). NO crees la tarea de las 6 pm salvo que Elías la pida (`instalar_tarea_18h.ps1` existe para eso).
7. Abre el enlace, entra con la clave y confirma que carga y muestra "actualizado <fecha hora>" en el encabezado.

## Reglas que NO se cambian sin que Elías lo pida
- Base de todo = Altas Pospago Mensual (DN, plan, forma de pago, usuario, nombre promotor). Registros FW y estatus Telefónica solo explican no-conversión.
- Facturas 1–4. Comisión del vendedor solo N1 $45, N2 $78, N3 $89 (máx $212), sin pago por alta ni por plan.
- Cobranza = facturas pagadas entre consideradas (vencidas + pagadas antes de vencer).
- Perdida = línea baja/exportada/predesactivada; si no, recuperable.
- DN enmascarado; no mostrar esquema de agencia ni proformas.
- Cuota: `CUOTAS\Benber\MM_2026.xlsx` hoja CAPILARIDAD col POSPAGO. Se usan TODOS los archivos de la carpeta, sin omitir ninguno (decisión de Elías); el mes sale del nombre del archivo, aunque la columna MES diga otro.
- La contraseña se recuerda solo en la pestaña (sessionStorage); al abrir de nuevo el enlace la vuelve a pedir.

## Seguridad (repo público)
- Publicar SIEMPRE `salida/index.html` (cifrado). `salida/index_abierto.html` trae datos en claro: solo local, está en `.gitignore`.
- Si falta la clave el script se niega a publicar. No pongas `permitir_publico` sin que Elías lo pida.

## Mantenimiento
- Diagnóstico: `centro-mando-pospago/salida/log.txt` y `salida/estado.json`. Si la validación falla (>15% de caída) NO se publica; revisa que los archivos fuente estén completos/sincronizados en OneDrive.
- La interfaz vive en `plantilla_centro_mando.html` (HTML+JS con marcadores `__DATA__` y `__ASSETS__`). La lógica de datos está en `build_centro_mando.py` (`cruce` y `mkdata`).
- Tras cualquier cambio: corre el script, abre `index_abierto.html` y compara altas/cuota/facturas contra la corrida anterior antes de publicar.
- El historial de git crece ~4 MB por publicación; si el repo se pone pesado, ofrecer a Elías un squash del historial de `docs/pospago`.
