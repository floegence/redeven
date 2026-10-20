import { render } from 'solid-js/web';
import { NativeCanvas, notifyNativeCanvasError } from './NativeCanvas';
import '@floegence/floe-webapp-core/styles';
import '../tessiven.css';
import '../../native/native.css';

window.addEventListener('error', notifyNativeCanvasError);
window.addEventListener('unhandledrejection', notifyNativeCanvasError);
render(() => <NativeCanvas />, document.getElementById('root')!);
