# Crea la tarea programada: lunes a viernes 6:00 pm.
# Clic derecho > "Ejecutar con PowerShell"  (no requiere ser administrador).
$bat  = Join-Path $PSScriptRoot 'actualizar_centro_mando.bat'
$acc  = New-ScheduledTaskAction -Execute $bat -WorkingDirectory $PSScriptRoot
$trg  = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 6:00PM
$set  = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName 'Centro de Mando Pospago' -Action $acc -Trigger $trg -Settings $set -Force | Out-Null
Write-Host "Tarea creada: Centro de Mando Pospago - L a V 6:00 pm"
Write-Host "Si la PC esta apagada a esa hora, se ejecuta al encenderla (StartWhenAvailable)."
Read-Host "Enter para cerrar"
