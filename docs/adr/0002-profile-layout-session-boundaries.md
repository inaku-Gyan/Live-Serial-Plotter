# Separate profiles, layout presets, and window session overrides

Profile configuration describes serial and parsing semantics plus a default
Layout Preset reference, while a Layout Preset stores reusable page, tile, and
renderer view defaults. An open Monitor Page keeps temporary Window Session
Overrides; Reset View and Reset Layout restore their respective layers, and only
explicit Save Layout or Save As writes overrides back to a preset. Switching
profiles loads the new default preset and drops unsaved overrides. This keeps
reusable device semantics independent from per-window arrangement and prevents
live data or transient interaction state from becoming configuration.
