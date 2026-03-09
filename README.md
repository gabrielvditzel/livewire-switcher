# Livewire Switcher

Switch between paired Laravel Livewire files with `CMD + Alt + L` on macOS or `Ctrl + Alt + L` on other platforms.

## Credits

This extension is a fork of the original [Livewire Switcher](https://github.com/bebo925/livewire-switcher) by [bebo925](https://github.com/bebo925).
This fork adds support for Livewire 4 multi-file components while preserving the legacy switching workflow.

## Supported layouts

- Livewire 4 multi-file components in `resources/views/components`, `resources/views/livewire`, `resources/views/pages`, and `resources/views/layouts`
- Custom Livewire 4 component roots declared in `config/livewire.php` through `component_locations` and `component_namespaces`
- Legacy class-based components in `app/Http/Livewire` or `app/Livewire` paired with Blade views in `resources/views/livewire`
- Custom legacy roots declared in `config/livewire.php` through `class_path` and `view_path`

## Behavior

- Inside a multi-file component, the shortcut cycles through `<name>.php`, `<name>.blade.php`, `<name>.js`, and `<name>.test.php` when those files exist
- Inside a legacy Livewire component, the shortcut toggles between the class and Blade view
- Multi-file cycle order is `PHP -> Blade -> JS -> Test -> PHP`, skipping missing files
- Auxiliary multi-file files such as `.css` and `.global.css` do not switch anywhere
- Single-file Livewire 4 Blade components do not switch anywhere because they do not have a paired PHP file

## Notes

- The extension keeps the existing command id `livewire-switcher.switch`
- `config/livewire.php` is parsed statically; dynamic runtime registrations such as `Livewire::addLocation()` are not discovered
