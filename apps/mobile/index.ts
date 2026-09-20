import './src/i18n/rtl-preset';
// Defines the background location task. It has to be registered at startup, because the OS can start it
// with no screen mounted (the driver is in another app during a delivery).
import './src/core/background-location';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
