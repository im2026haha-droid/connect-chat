# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['C:\\Users\\ckguswns\\AppData\\Local\\Temp\\opencode\\sns-chat\\server.py'],
    pathex=[],
    binaries=[],
    datas=[('C:\\Users\\ckguswns\\AppData\\Local\\Temp\\opencode\\sns-chat\\index.html', '.'), ('C:\\Users\\ckguswns\\AppData\\Local\\Temp\\opencode\\sns-chat\\style.css', '.'), ('C:\\Users\\ckguswns\\AppData\\Local\\Temp\\opencode\\sns-chat\\script.js', '.')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='ConnectChat',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
