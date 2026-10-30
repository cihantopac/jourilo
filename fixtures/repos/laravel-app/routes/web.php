<?php
Route::get('/', fn () => view('welcome'));
Route::get('/pricing', [PlanController::class, 'index']);
Route::get('/register', [RegisteredUserController::class, 'create']);
Route::get('/admin/users/{user}', [AdminController::class, 'show']);
