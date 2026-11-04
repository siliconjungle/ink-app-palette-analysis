// Keep previewing independent of the editor's startup and side effects.
if(new URLSearchParams(location.search).get('mode')==='preview'){await import('./quick-look-renderer.mjs');}else{await import("./app.mjs");}
