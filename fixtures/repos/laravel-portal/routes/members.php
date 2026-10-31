<?php

use App\Livewire\Login;
use App\Livewire\Dashboard;
use App\Livewire\Settings;
use Illuminate\Support\Facades\Route;

$domain = config('portal.members_domain');

Route::domain($domain)->prefix($domain ? '' : 'members')->name('members.')->group(function () {
    Route::get('/', fn () => view('members.landing'))->name('landing');

    Route::middleware('members.guest')->group(function () {
        Route::livewire('/login', Login::class)->name('login');
        Route::livewire('/reset-password/{token}', \App\Livewire\ResetPassword::class);
    });

    Route::middleware(['members.auth', 'verified'])->group(function () {
        Route::livewire('/dashboard', Dashboard::class)->name('dashboard');
        Route::livewire('/settings', Settings::class)->name('settings');
        Route::delete('/account', fn () => null)->name('account.delete');
    });

    // Old paths kept as redirects.
    Route::redirect('/giris', '/login', 301);
});
