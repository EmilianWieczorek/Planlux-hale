-- Planlux Hale – opcjonalne dane testowe
-- Uruchomienie: sqlite3 planlux.db < scripts/seed.sql

-- Przykładowy admin (hasło: admin123 – hash z crypto.scrypt)
-- INSERT INTO users (id, email, password_hash, role, display_name, active) 
-- VALUES ('admin-1', 'admin@planlux.pl', '<hash>', 'ADMIN', 'Administrator', 1);

-- Migracje tworzą tabelę users; seed może dodać dane testowe.
-- W aplikacji Electron admin jest tworzony przy pierwszym uruchomieniu (planlux:seedAdmin).
