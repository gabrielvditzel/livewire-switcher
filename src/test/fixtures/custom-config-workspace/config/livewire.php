<?php

return [
    /*
    |---------------------------------------------------------------------------
    | Test overrides
    |---------------------------------------------------------------------------
    */
    'component_locations' => [
        resource_path('views/ui'),
    ],

    'component_namespaces' => [
        'dash' => base_path('resources/views/dashboards'),
    ],

    'class_path' => 'app/Domains/Livewire',

    'view_path' => resource_path('views/custom-livewire'),
];
