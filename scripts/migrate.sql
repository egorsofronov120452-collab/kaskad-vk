-- VK Bot Database Schema
-- Таблицы для хранения ЧС, мутов, приветствий и пользователей

CREATE TABLE IF NOT EXISTS blacklist (
  user_id      BIGINT PRIMARY KEY,
  end_date     BIGINT NOT NULL DEFAULT 0,  -- 0 = перманентно, иначе timestamp ms
  reason       TEXT   NOT NULL DEFAULT 'Нарушение правил',
  banned_at    BIGINT NOT NULL,
  banned_by    BIGINT
);

CREATE TABLE IF NOT EXISTS mutes (
  user_id    BIGINT PRIMARY KEY,
  end_date   BIGINT NOT NULL,
  reason     TEXT   NOT NULL DEFAULT 'Нарушение правил',
  muted_at   BIGINT NOT NULL,
  muted_by   BIGINT
);

CREATE TABLE IF NOT EXISTS greetings (
  peer_id     BIGINT PRIMARY KEY,
  text        TEXT   NOT NULL DEFAULT '',
  attachments TEXT   NOT NULL DEFAULT '[]'  -- JSON array of attachment strings
);

CREATE TABLE IF NOT EXISTS users (
  vk_id       BIGINT PRIMARY KEY,
  first_name  TEXT,
  last_name   TEXT,
  role        TEXT,  -- rs, ss, kurier, stazher, null
  joined_at   BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000,
  updated_at  BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000
);
