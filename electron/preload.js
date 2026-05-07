const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__shrimp__', {
    isElectron: true,
});

contextBridge.exposeInMainWorld('electronAPI', {
    minimize:  () => ipcRenderer.send('window-minimize'),
    maximize:  () => ipcRenderer.send('window-maximize'),
    close:     () => ipcRenderer.send('window-close'),
    onMaximizeChange: (cb) => {
        const onMax   = () => cb(true);
        const onUnmax = () => cb(false);
        ipcRenderer.on('window-maximized',   onMax);
        ipcRenderer.on('window-unmaximized', onUnmax);
        return () => {
            ipcRenderer.removeListener('window-maximized',   onMax);
            ipcRenderer.removeListener('window-unmaximized', onUnmax);
        };
    },
    getElectronPrefs: () => ipcRenderer.invoke('electron-prefs:get'),
    setElectronPref:  (key, value) => ipcRenderer.invoke('electron-prefs:set', key, value),
    relaunch:         () => ipcRenderer.send('app:relaunch'),
});
