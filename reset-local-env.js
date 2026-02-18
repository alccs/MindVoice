const { app } = require('electron');
app.setName('mindvoice'); // Target correct config path
const store = require('./lib/store');

console.log('Old settings:');
console.log('Provider:', store.get('apiProvider'));
console.log('PythonPath:', store.get('pythonPath'));

store.set('apiProvider', 'local');
store.set('pythonPath', 'F:\\anaconda3\\envs\\mindvoice-qwen\\python.exe');
store.set('localModel', 'qwen');

console.log('New settings applied:');
console.log('Provider:', store.get('apiProvider'));
console.log('PythonPath:', store.get('pythonPath'));
console.log('LocalModel:', store.get('localModel'));

app.quit();
