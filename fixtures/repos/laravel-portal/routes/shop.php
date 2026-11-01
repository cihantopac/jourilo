<?php

use Illuminate\Support\Facades\Route;

Route::get('/products', fn () => view('shop.index'));
Route::get('/products/{product}', fn () => view('shop.show'));
Route::inertia('/cart', 'Cart');
