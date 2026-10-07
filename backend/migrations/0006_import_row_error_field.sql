-- Which column of an import row caused its validation error (drives inline editing).
ALTER TABLE import_rows ADD COLUMN error_field VARCHAR(40) NULL;
