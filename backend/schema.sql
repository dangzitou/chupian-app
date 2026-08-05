CREATE DATABASE IF NOT EXISTS chupian CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE chupian;

CREATE TABLE IF NOT EXISTS spots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  spot_code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(128) NOT NULL,
  district VARCHAR(64) DEFAULT '',
  latitude DECIMAL(10,7) DEFAULT NULL,
  longitude DECIMAL(10,7) DEFAULT NULL,
  category VARCHAR(32) DEFAULT 'street',
  best_time ENUM('day', 'golden', 'night') DEFAULT 'day',
  time_window VARCHAR(80) DEFAULT '',
  tags JSON DEFAULT ('[]'),
  styles JSON DEFAULT ('[]'),
  description TEXT,
  cover VARCHAR(500) DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS posts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  author_name VARCHAR(64) NOT NULL DEFAULT '匿名拍友',
  author_bio VARCHAR(120) DEFAULT '',
  spot_id BIGINT UNSIGNED DEFAULT NULL,
  spot_name VARCHAR(128) DEFAULT '',
  district VARCHAR(64) DEFAULT '',
  direction VARCHAR(80) DEFAULT '',
  angle VARCHAR(80) DEFAULT '',
  time_window VARCHAR(80) DEFAULT '',
  best_time ENUM('day', 'golden', 'night') DEFAULT 'day',
  shot_at DATETIME DEFAULT NULL,
  camera VARCHAR(80) DEFAULT '',
  lens VARCHAR(80) DEFAULT '',
  focal_length VARCHAR(40) DEFAULT '',
  aperture VARCHAR(24) DEFAULT '',
  shutter VARCHAR(24) DEFAULT '',
  iso VARCHAR(24) DEFAULT '',
  white_balance VARCHAR(40) DEFAULT '',
  media_type VARCHAR(20) DEFAULT 'image',
  cover_url VARCHAR(500) DEFAULT '',
  stats_likes INT UNSIGNED DEFAULT 0,
  stats_favorites INT UNSIGNED DEFAULT 0,
  stats_views INT UNSIGNED DEFAULT 0,
  status ENUM('published', 'pending', 'archived') DEFAULT 'published',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_posts_created (created_at, id),
  INDEX idx_posts_spot (spot_id),
  CONSTRAINT fk_posts_spot FOREIGN KEY (spot_id) REFERENCES spots (id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS post_media (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  post_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('image', 'video', 'live') NOT NULL DEFAULT 'image',
  url VARCHAR(500) NOT NULL,
  cover_url VARCHAR(500) DEFAULT '',
  width INT DEFAULT 0,
  height INT DEFAULT 0,
  duration INT DEFAULT 0,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_post_media_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
  INDEX idx_media_post (post_id, sort_order),
  INDEX idx_media_kind (kind)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS post_likes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  post_id BIGINT UNSIGNED NOT NULL,
  actor_id VARCHAR(64) NOT NULL,
  actor_name VARCHAR(80) DEFAULT '匿名拍友',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_post_likes_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
  UNIQUE KEY uniq_post_actor_like (post_id, actor_id),
  INDEX idx_like_post (post_id),
  INDEX idx_like_actor (actor_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS post_favorites (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  post_id BIGINT UNSIGNED NOT NULL,
  actor_id VARCHAR(64) NOT NULL,
  actor_name VARCHAR(80) DEFAULT '匿名拍友',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_post_favorites_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
  UNIQUE KEY uniq_post_actor_favorite (post_id, actor_id),
  INDEX idx_fav_post (post_id),
  INDEX idx_fav_actor (actor_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS post_comments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  post_id BIGINT UNSIGNED NOT NULL,
  actor_id VARCHAR(64) NOT NULL,
  actor_name VARCHAR(80) DEFAULT '匿名拍友',
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_post_comments_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
  INDEX idx_comment_post_created (post_id, id),
  INDEX idx_comment_actor (actor_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS post_tags (
  post_id BIGINT UNSIGNED NOT NULL,
  tag VARCHAR(48) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_post_tags_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag),
  INDEX idx_post_tags_tag (tag)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS post_styles (
  post_id BIGINT UNSIGNED NOT NULL,
  style VARCHAR(48) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_post_styles_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, style),
  INDEX idx_post_styles_style (style)
) ENGINE=InnoDB;

ALTER TABLE posts
  ADD INDEX IF NOT EXISTS idx_posts_status_created_id (status, created_at, id),
  ADD INDEX IF NOT EXISTS idx_posts_status_hot (status, stats_likes, created_at, id),
  ADD INDEX IF NOT EXISTS idx_posts_status_favorites (status, stats_favorites, created_at, id);

ALTER TABLE post_comments
  ADD INDEX IF NOT EXISTS idx_comment_post_created_id (post_id, created_at, id);
