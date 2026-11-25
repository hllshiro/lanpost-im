!macro customInstall
  DetailPrint "配置 Windows 防火墙入站规则..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="lanpost-im"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="内网传书"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name=all program="$INSTDIR\lanpost-im.exe" dir=in'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="内网传书" dir=in action=allow program="$INSTDIR\lanpost-im.exe" enable=yes profile=any'
  Pop $0
!macroend

!macro customUnInstall
  DetailPrint "移除 Windows 防火墙入站规则..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="lanpost-im"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="内网传书"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name=all program="$INSTDIR\lanpost-im.exe" dir=in'
  Pop $0
!macroend
