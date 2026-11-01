<?php

use App\Http\Controllers\PageController;
use Illuminate\Support\Facades\Route;

// Public pages. A comment with Route::get('/commented-out') must be ignored.
Route::get('/', [PageController::class, 'home'])->name('home');
Route::view('/about', 'about');
/* Route::get('/old', fn () => 'x'); */

// Member area, nested groups with a configurable prefix (empty on its own domain, /members locally).
require __DIR__.'/members.php';

Route::prefix('help')->group(function () {
    Route::get('/', [PageController::class, 'help'])->name('help');
    Route::get('/articles/{slug}', [PageController::class, 'article']);
    Route::post('/feedback', [PageController::class, 'feedback']);
});
