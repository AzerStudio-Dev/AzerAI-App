!macro customRemoveFiles
  IfSilent silent_active normal_uninstall

  silent_active:
    # Yükleyici tərəfindən arxa planda (silent) çağrıldıqda (məs. yeniləmə və ya yenidən quraşdırma zamanı)
    # Qovluğu silmirik, yalnız faylları yeniləmək üçün uninstaller-dən çıxırıq
    !insertmacro quitSuccess

  normal_uninstall:
    # İstifadəçi özü proqramı tamamilə siləndə (uninstall edəndə) qovluğu təmizləyirik
    RMDir /r $INSTDIR
!macroend
