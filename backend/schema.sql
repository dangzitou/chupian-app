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
  INDEX idx_spots_lat_lng (latitude, longitude),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  username VARCHAR(32) NOT NULL UNIQUE,
  display_name VARCHAR(64) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  bio VARCHAR(160) NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_display_name (display_name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS posts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  author_id VARCHAR(64) DEFAULT '',
  author_name VARCHAR(64) NOT NULL DEFAULT '匿名拍友',
  author_bio VARCHAR(120) DEFAULT '',
  spot_id BIGINT UNSIGNED DEFAULT NULL,
  spot_name VARCHAR(128) DEFAULT '',
  district VARCHAR(64) DEFAULT '',
  latitude DECIMAL(10,7) DEFAULT NULL,
  longitude DECIMAL(10,7) DEFAULT NULL,
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
  INDEX idx_posts_shot_at (shot_at),
  INDEX idx_posts_status_lat_lng (status, latitude, longitude, created_at, id),
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

CREATE TABLE IF NOT EXISTS author_follows (
  follower_id VARCHAR(64) NOT NULL,
  followed_id VARCHAR(64) NOT NULL,
  actor_name VARCHAR(64) DEFAULT '匿名拍友',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (follower_id, followed_id),
  INDEX idx_af_follower (follower_id),
  INDEX idx_af_followed (followed_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  recipient_id VARCHAR(64) NOT NULL,
  actor_id VARCHAR(64) NOT NULL,
  actor_name VARCHAR(80) NOT NULL DEFAULT '匿名拍友',
  type ENUM('like', 'favorite', 'comment', 'follow') NOT NULL,
  post_id BIGINT UNSIGNED DEFAULT NULL,
  post_title VARCHAR(200) NOT NULL DEFAULT '',
  content VARCHAR(300) NOT NULL DEFAULT '',
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE SET NULL,
  INDEX idx_notifications_recipient_created (recipient_id, created_at, id),
  INDEX idx_notifications_recipient_read (recipient_id, is_read, created_at, id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS post_reports (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  post_id BIGINT UNSIGNED NOT NULL,
  reporter_id VARCHAR(64) NOT NULL,
  reason ENUM('misleading', 'copyright', 'unsafe', 'spam', 'other') NOT NULL,
  details VARCHAR(500) NOT NULL DEFAULT '',
  status ENUM('open', 'reviewed', 'dismissed') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_post_reports_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
  UNIQUE KEY uniq_post_reporter (post_id, reporter_id),
  INDEX idx_reports_status_created (status, created_at, id),
  INDEX idx_reports_post (post_id, created_at, id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS blocked_authors (
  blocker_id VARCHAR(64) NOT NULL,
  blocked_id VARCHAR(64) NOT NULL,
  blocked_name VARCHAR(80) NOT NULL DEFAULT '匿名拍友',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_id, blocked_id),
  INDEX idx_blocked_blocker_created (blocker_id, created_at),
  INDEX idx_blocked_target (blocked_id)
) ENGINE=InnoDB;

ALTER TABLE posts
  ADD INDEX IF NOT EXISTS idx_posts_status_created_id (status, created_at, id),
  ADD INDEX IF NOT EXISTS idx_posts_status_hot (status, stats_likes, created_at, id),
  ADD INDEX IF NOT EXISTS idx_posts_status_favorites (status, stats_favorites, created_at, id);

ALTER TABLE posts
  ADD INDEX IF NOT EXISTS idx_posts_author_id (author_id),
  ADD INDEX IF NOT EXISTS idx_posts_author_status_created (author_id, status, created_at, id),
  ADD INDEX IF NOT EXISTS idx_posts_status_author (status, author_id, created_at, id);

ALTER TABLE posts
  ADD INDEX IF NOT EXISTS idx_posts_spot_name (spot_name),
  ADD INDEX IF NOT EXISTS idx_posts_district (district),
  ADD INDEX IF NOT EXISTS idx_posts_best_time (best_time),
  ADD FULLTEXT INDEX IF NOT EXISTS ft_posts_search (title, content, spot_name, district);

ALTER TABLE post_comments
  ADD INDEX IF NOT EXISTS idx_comment_post_created_id (post_id, created_at, id);
