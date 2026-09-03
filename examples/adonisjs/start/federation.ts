/*
|--------------------------------------------------------------------------
| Federation preload file
|--------------------------------------------------------------------------
|
| Imported while the application boots, after every service provider has
| booted and before the HTTP server starts accepting connections. This is
| where Fedify's actor dispatchers, collection dispatchers and inbox
| listeners get registered.
|
*/

import "../app/federation/main.js";
