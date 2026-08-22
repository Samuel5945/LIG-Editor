; 升级安装时自动关闭旧版应用进程（改名前「图文编辑器」/ 改名后「立格编辑器」）
; 背景：安装器要覆盖 <安装目录>\立格编辑器.exe，而正在运行的 exe 被 Windows
; 锁定无法覆盖，之前只能让用户手动关闭。此钩子在 NSIS 检测运行中应用之前执行，
; 找到运行中的进程即强制结束并等待句柄释放，实现「装新版自动关旧进程」；
; 顺带关掉旧版「图文编辑器」进程，保证新版首启能把 文档\图文编辑器 数据目录改名迁移过来。
;
; 注意：此文件含中文字符串，必须保持 UTF-8（带 BOM）编码，makensis 才能正确编译。

!macro customInit
  nsProcess::_FindProcess "图文编辑器.exe"
  Pop $R0
  IntCmp $R0 0 0 next done
  DetailPrint "检测到旧版图文编辑器正在运行，正在自动关闭..."
  nsProcess::_KillProcess "图文编辑器.exe"
  Pop $R0
  ; 等待文件句柄释放，避免数据目录迁移时仍被占用
  Sleep 2500
next:
  nsProcess::_FindProcess "立格编辑器.exe"
  Pop $R0
  IntCmp $R0 0 0 done done
  DetailPrint "检测到立格编辑器正在运行，正在自动关闭..."
  nsProcess::_KillProcess "立格编辑器.exe"
  Pop $R0
  Sleep 2500
done:
!macroend
