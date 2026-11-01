<?php

return [
    'defaults' => ['guard' => 'web', 'passwords' => 'users'],

    'guards' => [
        'web' => [
            'driver' => 'session',
            'provider' => 'users',
        ],
        'members' => [
            'driver' => 'session',
            'provider' => 'members',
        ],
    ],

    'providers' => [
        'users' => ['driver' => 'eloquent', 'model' => App\Models\User::class],
    ],
];
