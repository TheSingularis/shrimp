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
        // Return cleanup
        return () => {
            ipcRenderer.removeListener('window-maximized',   onMax);
            ipcRenderer.removeListener('window-unmaximized', onUnmax);
        };
    },
});
