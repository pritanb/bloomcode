'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Sandboxed Electron preload. */
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tutorDesktop', {
  platform: process.platform,
  getNavigation: () => ipcRenderer.invoke('desktop:navigation'),
  navigate: direction => {
    if (direction === 'back' || direction === 'forward') ipcRenderer.send('desktop:navigate', direction);
  },
  onNavigation: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop:navigation-changed', listener);
    return () => ipcRenderer.removeListener('desktop:navigation-changed', listener);
  },
});
