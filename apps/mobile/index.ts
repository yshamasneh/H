import './src/i18n/rtl-preset';
// Defines the background location task. It has to be registered at startup, because the OS can start it
// with no screen mounted (the driver is in another app during a delivery).
import './src/core/background-location';
import { registerRootComponent } from 'expo';
import { installGlobalErrorReporting } from './src/core/app-error-reporter';
import App from './App';

// Store audit M2: does nothing unless EXPO_PUBLIC_ERROR_REPORT_URL is set.
installGlobalErrorReporting();
registerRootComponent(App);
