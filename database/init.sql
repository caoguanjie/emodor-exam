-- =====================================================================
-- EmodorRuleExam 制度学习及考试系统 · 数据库初始化脚本
-- 依据 docs/design/03-数据库设计.md 建表（当前 41 张业务表 + 1 张迁移元数据表，InnoDB + utf8mb4）
-- 时间字段 DATETIME(3)；无数据库级外键（03 册 1.6 节，应用层维护）
-- 枚举字段 VARCHAR + 应用层校验（03 册 1.7 节）
-- 种子数据（根部门 / 超级管理员）由 database/seed.mjs 按环境变量生成，
-- 本脚本不含任何明文口令（安全约束：源码不写可用凭据字面量）。
-- =====================================================================

CREATE DATABASE IF NOT EXISTS `ruleexam`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;
USE `ruleexam`;

-- ---------------------------------------------------------------------
-- 1. 组织权限域（2 张）
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `sys_department` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `parent_id`  BIGINT UNSIGNED NULL COMMENT '上级部门 id，根部门为 NULL',
  `name`       VARCHAR(64)  NOT NULL COMMENT '部门名称',
  `sort`       INT          NOT NULL DEFAULT 0 COMMENT '同级展示排序，升序',
  `status`     TINYINT      NOT NULL DEFAULT 1 COMMENT '1=启用，0=停用',
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_parent` (`parent_id`),
  UNIQUE KEY `uk_parent_name` (`parent_id`, `name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='部门树';

CREATE TABLE IF NOT EXISTS `sys_user` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`      VARCHAR(64)  NOT NULL COMMENT '登录用户名，全局唯一',
  `password_hash` VARCHAR(255) NOT NULL COMMENT '密码哈希（bcrypt，cost=12）',
  `real_name`     VARCHAR(64)  NOT NULL COMMENT '真实姓名',
  `employee_no`   VARCHAR(32)  NULL COMMENT '工号，全局唯一（NULL 不去重）',
  `department_id` BIGINT UNSIGNED NULL COMMENT '归属部门',
  `category_id`   BIGINT UNSIGNED NULL COMMENT '培训类别；旧用户未补齐时为 NULL',
  `source`        VARCHAR(16)  NULL COMMENT 'institution / external；旧用户未确认时为 NULL',
  `role`          VARCHAR(32)  NOT NULL DEFAULT 'employee' COMMENT 'super_admin / regulation_admin / employee',
  `phone`         VARCHAR(20)  NULL,
  `email`         VARCHAR(128) NULL,
  `avatar_id`     BIGINT UNSIGNED NULL COMMENT '受控媒体头像资源 id',
  `occupation`    VARCHAR(64)  NULL COMMENT '学员自维护工种展示字段',
  `gender`        VARCHAR(16)  NULL COMMENT 'male / female',
  `birthday`      DATE         NULL COMMENT '学员自维护生日；不得晚于服务端业务日期',
  `age`           TINYINT UNSIGNED NULL COMMENT '管理员维护年龄，0-150；不反推生日',
  `status`        TINYINT      NOT NULL DEFAULT 1 COMMENT '1=启用（在职），0=停用',
  `auth_version`  INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '认证世代；密码/身份/管理权限变更递增',
  `force_password_change` TINYINT NOT NULL DEFAULT 0 COMMENT '1=当前口令必须改密；与登录统计分离',
  `login_count`   INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '真实密码成功登录次数；refresh 不计入',
  `last_login_at` DATETIME(3)  NULL COMMENT '最后一次成功登录时间；refresh 不更新',
  `last_login_ip` VARCHAR(64)  NULL COMMENT '最后一次成功登录来源 IP',
  `roles_configured` TINYINT NOT NULL DEFAULT 0 COMMENT '1=已显式配置业务角色（含清空）',
  `deleted_at`    DATETIME(3)  NULL COMMENT '管理员逻辑删除；保留账号、角色关系与业务历史',
  `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`),
  UNIQUE KEY `uk_employee_no` (`employee_no`),
  UNIQUE KEY `uk_sys_user_phone` (`phone`),
  KEY `idx_department_status` (`department_id`, `status`),
  KEY `idx_training_identity` (`category_id`, `source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='员工账号';

CREATE TABLE IF NOT EXISTS `sys_role` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`       VARCHAR(64)  NOT NULL COMMENT '角色代码，单家机构内唯一',
  `name`       VARCHAR(128) NOT NULL COMMENT '角色名称',
  `remark`     VARCHAR(500) NULL COMMENT '角色备注',
  `is_system`  TINYINT      NOT NULL DEFAULT 0 COMMENT '1=系统角色，不可删除',
  `status`     TINYINT      NOT NULL DEFAULT 1 COMMENT '1=启用，0=停用',
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sys_role_code` (`code`),
  UNIQUE KEY `uk_sys_role_name` (`name`),
  KEY `idx_sys_role_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='可配置业务角色';

CREATE TABLE IF NOT EXISTS `sys_permission` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`       VARCHAR(128) NOT NULL COMMENT '服务端注册权限代码',
  `name`       VARCHAR(128) NOT NULL COMMENT '权限名称',
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sys_permission_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='权限白名单';

CREATE TABLE IF NOT EXISTS `sys_role_permission` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `role_id`       BIGINT UNSIGNED NOT NULL COMMENT '角色 id',
  `permission_id` BIGINT UNSIGNED NOT NULL COMMENT '权限 id',
  `created_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sys_role_permission` (`role_id`, `permission_id`),
  KEY `idx_sys_role_permission_permission` (`permission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='角色权限关系';

CREATE TABLE IF NOT EXISTS `sys_user_role` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    BIGINT UNSIGNED NOT NULL COMMENT '用户 id',
  `role_id`    BIGINT UNSIGNED NOT NULL COMMENT '业务角色 id',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sys_user_role` (`user_id`, `role_id`),
  KEY `idx_sys_user_role_role` (`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户业务角色关系';

CREATE TABLE IF NOT EXISTS `auth_session` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sid`          VARCHAR(64) NOT NULL COMMENT 'JWT 会话标识',
  `user_id`      BIGINT UNSIGNED NOT NULL COMMENT '会话用户',
  `client`       VARCHAR(16) NOT NULL DEFAULT 'pc' COMMENT 'pc / mobile',
  `auth_method`  VARCHAR(16) NOT NULL DEFAULT 'password' COMMENT 'password / sms / debug',
  `user_agent`   VARCHAR(255) NULL,
  `ip_address`   VARCHAR(64) NULL,
  `last_seen_at` DATETIME(3) NOT NULL,
  `expires_at`   DATETIME(3) NOT NULL COMMENT '当前 refresh 会话到期时间；刷新后顺延完整 TTL',
  `revoked_at`   DATETIME(3) NULL,
  `created_at`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_auth_session_sid` (`sid`),
  KEY `idx_auth_session_user_active` (`user_id`, `revoked_at`),
  KEY `idx_auth_session_last_seen` (`last_seen_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='认证会话';

CREATE TABLE IF NOT EXISTS `learner_identity` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`             BIGINT UNSIGNED NOT NULL COMMENT '实名学员（sys_user.id），应用层维护引用',
  `id_fingerprint`      CHAR(64) NOT NULL COMMENT '证件号 HMAC 指纹；不保存明文',
  `identity_encrypted`  TEXT NOT NULL COMMENT 'AES-256-GCM 加密的姓名与证件号',
  `session_id`          CHAR(36) NOT NULL COMMENT '完成绑定的实名会话',
  `provider_request_id` VARCHAR(128) NOT NULL COMMENT '脱敏供应商请求标识',
  `verified_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_learner_identity_user` (`user_id`),
  UNIQUE KEY `uk_learner_identity_fingerprint` (`id_fingerprint`),
  UNIQUE KEY `uk_learner_identity_session` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='学员实名权威事实';

CREATE TABLE IF NOT EXISTS `identity_verification_session` (
  `id`                       CHAR(36) NOT NULL,
  `user_id`                  BIGINT UNSIGNED NOT NULL COMMENT '当前学员（sys_user.id）',
  `face_asset_id`            BIGINT UNSIGNED NOT NULL,
  `id_card_portrait_asset_id` BIGINT UNSIGNED NOT NULL,
  `id_card_emblem_asset_id`  BIGINT UNSIGNED NOT NULL,
  `material_fingerprint`     CHAR(64) NOT NULL COMMENT '用户与三项资产的稳定摘要',
  `status`                   VARCHAR(24) NOT NULL COMMENT 'created/provider_pending/provider_unknown/provider_verified/verified/rejected/expired',
  `provider`                 VARCHAR(32) NOT NULL,
  `provider_request_id`      VARCHAR(128) NULL,
  `provider_result_encrypted` TEXT NULL COMMENT '先持久化的加密供应商结果；绑定恢复不重复调用供应商',
  `provider_lease_until`     DATETIME(3) NULL COMMENT '跨实例调用 claim 到期时间',
  `reason_code`              VARCHAR(64) NULL,
  `expires_at`               DATETIME(3) NOT NULL,
  `bound_at`                 DATETIME(3) NULL,
  `bound_event_id`           CHAR(36) NULL COMMENT '事务性脱敏绑定审计事实',
  `created_at`               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_identity_session_user_created` (`user_id`, `created_at`),
  KEY `idx_identity_session_material` (`user_id`, `material_fingerprint`),
  UNIQUE KEY `uk_identity_session_bound_event` (`bound_event_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='学员实名核验会话';

-- ---------------------------------------------------------------------
-- 2. 培训身份与可恢复导入域（2 张）
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `training_category` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(128) NOT NULL COMMENT '培训类别名称，全局唯一',
  `description` TEXT         NULL COMMENT '类别说明',
  `status`      TINYINT      NOT NULL DEFAULT 1 COMMENT '1=启用，0=停用',
  `created_by`  BIGINT UNSIGNED NOT NULL COMMENT '创建人（sys_user.id）',
  `created_at`  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_training_category_name` (`name`),
  KEY `idx_training_category_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='培训类别';

CREATE TABLE IF NOT EXISTS `import_batch` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_id`        BIGINT UNSIGNED NOT NULL COMMENT '发起管理员（sys_user.id）',
  `kind`            VARCHAR(32) NOT NULL COMMENT 'students / questions',
  `input_hash`      CHAR(64)    NOT NULL COMMENT '脱敏输入指纹，不含明文口令',
  `status`          VARCHAR(16) NOT NULL DEFAULT 'previewed' COMMENT 'previewed / committing / committed / failed',
  `normalized_rows` JSON        NULL COMMENT '规范化行；学员口令仅保留 password_hash',
  `valid_rows`      JSON        NULL COMMENT '预检查通过行号',
  `errors`          JSON        NULL COMMENT '行级错误（不得包含口令或哈希）',
  `duplicates`      JSON        NULL COMMENT '批内重复行号',
  `committed_rows`  JSON        NULL COMMENT '首次确认的固定行号集合',
  `created_ids`     JSON        NULL COMMENT '提交创建的实体 ID',
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_import_batch_owner_kind` (`owner_id`, `kind`),
  KEY `idx_import_batch_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='可恢复导入批次';

-- ---------------------------------------------------------------------
-- 3. 制度域（3 张）
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `regulation` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title`              VARCHAR(128) NOT NULL COMMENT '制度标题',
  `category`           VARCHAR(32)  NOT NULL COMMENT '制度分类',
  `category_id`        BIGINT UNSIGNED NULL COMMENT '可选培训类别；独立于 legacy category 字符串',
  `description`        VARCHAR(512) NULL COMMENT '制度描述/摘要',
  `status`             VARCHAR(16)  NOT NULL DEFAULT 'draft' COMMENT 'draft / published / archived',
  `current_version_id` BIGINT UNSIGNED NULL COMMENT '当前生效版本（regulation_version.id）',
  `required_minutes`   INT          NOT NULL DEFAULT 10 COMMENT '规定有效学习时长阈值（分钟）',
  `scroll_segments`    INT          NOT NULL DEFAULT 10 COMMENT '滚动分段数（本期固定 10）',
  `created_by`         BIGINT UNSIGNED NOT NULL COMMENT '创建人（sys_user.id）',
  `published_at`       DATETIME(3)  NULL COMMENT '首次发布时间',
  `created_at`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_status_category` (`status`, `category`),
  KEY `idx_regulation_category_id` (`category_id`),
  KEY `idx_created_by` (`created_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='制度主档';

CREATE TABLE IF NOT EXISTS `regulation_version` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `regulation_id` BIGINT UNSIGNED NOT NULL COMMENT '所属制度',
  `version_no`    INT          NOT NULL COMMENT '版本号，同制度内从 1 递增',
  `file_path`     VARCHAR(255) NOT NULL COMMENT '文件存储相对路径',
  `file_type`     VARCHAR(8)   NOT NULL COMMENT 'pdf / docx',
  `file_hash`     CHAR(64)     NOT NULL COMMENT '文件 SHA-256（十六进制 64 字符）',
  `content_html`  MEDIUMTEXT   NULL COMMENT '解析产物：在线阅读用 HTML（docx）',
  `text_content`  MEDIUMTEXT   NULL COMMENT '解析产物：纯文本（AI 出题输入）',
  `parse_status`  VARCHAR(16)  NOT NULL DEFAULT 'pending' COMMENT 'pending / parsed / failed',
  `parsed_at`     DATETIME(3)  NULL COMMENT '解析完成时刻',
  `retry_count`   INT          NOT NULL DEFAULT 0 COMMENT '解析重试计数',
  `created_by`    BIGINT UNSIGNED NOT NULL COMMENT '上传人（sys_user.id）',
  `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_regulation_version_no` (`regulation_id`, `version_no`),
  KEY `idx_parse_status` (`parse_status`),
  KEY `idx_file_hash` (`file_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='制度版本';

CREATE TABLE IF NOT EXISTS `regulation_scope` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `regulation_id` BIGINT UNSIGNED NOT NULL COMMENT '制度',
  `department_id` BIGINT UNSIGNED NULL COMMENT '被圈定部门；is_all=1 时为 NULL',
  `is_all`        TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1=面向全员，0=按部门圈定',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_regulation_department` (`regulation_id`, `department_id`),
  KEY `idx_department` (`department_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='发布范围';

-- ---------------------------------------------------------------------
-- 3. 学习域（2 张）
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `learning_session` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`          BIGINT UNSIGNED NOT NULL COMMENT '学习者',
  `regulation_id`    BIGINT UNSIGNED NOT NULL COMMENT '学习的制度',
  `version_id`       BIGINT UNSIGNED NOT NULL COMMENT '阅读的制度版本',
  `started_at`       DATETIME(3)  NOT NULL COMMENT '会话开始时间',
  `ended_at`         DATETIME(3)  NULL COMMENT '会话结束时间；NULL=进行中或待收口',
  `duration_seconds` INT          NOT NULL DEFAULT 0 COMMENT '本会话有效时长（秒，容差校验后）',
  PRIMARY KEY (`id`),
  KEY `idx_user_regulation_started` (`user_id`, `regulation_id`, `started_at`),
  KEY `idx_regulation_started` (`regulation_id`, `started_at`),
  KEY `idx_started_at` (`started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='学习会话';

CREATE TABLE IF NOT EXISTS `learning_record` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`            BIGINT UNSIGNED NOT NULL COMMENT '学习者',
  `regulation_id`      BIGINT UNSIGNED NOT NULL COMMENT '制度',
  `version_id`         BIGINT UNSIGNED NOT NULL COMMENT '最近学习版本',
  `total_seconds`      INT             NOT NULL DEFAULT 0 COMMENT '累计有效学习时长（秒）',
  `max_scroll_percent` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '最大滚动百分比（0~100）',
  `scroll_coverage`    JSON            NOT NULL COMMENT '滚动覆盖位图（10 段）',
  `is_valid`           TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '1=有效学习达标',
  `valid_at`           DATETIME(3)     NULL COMMENT '首次达标时间',
  `last_learn_at`      DATETIME(3)     NULL COMMENT '最近一次学习时间',
  `created_at`         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_regulation` (`user_id`, `regulation_id`),
  KEY `idx_regulation_valid` (`regulation_id`, `is_valid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='学习汇总';

-- ---------------------------------------------------------------------
-- 4. 考试域（5 张 legacy + 2 张题库增量）
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `question` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `regulation_id`      BIGINT UNSIGNED NULL COMMENT '可选制度来源',
  `version_id`         BIGINT UNSIGNED NULL COMMENT '兼容字段：可选制度版本来源',
  `category_id`        BIGINT UNSIGNED NULL COMMENT '培训类别；旧题未知保持 NULL',
  `difficulty`         VARCHAR(16) NULL COMMENT 'easy / medium / hard；旧题未知保持 NULL',
  `concept_id`         BIGINT UNSIGNED NULL COMMENT '可选同考点组',
  `current_version_id` BIGINT UNSIGNED NULL COMMENT '当前题目版本；旧题首次修订或发布时捕获',
  `is_enabled`         TINYINT(1) NOT NULL DEFAULT 1,
  `deleted_at`         DATETIME(3) NULL,
  `type`               VARCHAR(16)  NOT NULL COMMENT 'single / multiple / judgment',
  `stem`               TEXT         NOT NULL COMMENT '题干',
  `options`            JSON         NOT NULL COMMENT '选项数组 [{key,text}]',
  `answer`             JSON         NOT NULL COMMENT '正确答案（选项下标数组）',
  `analysis`           TEXT         NULL COMMENT '答案解析',
  `content_schema_version` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `content_json`       JSON NULL,
  `score`              DECIMAL(5,2) NULL COMMENT '历史兼容列；新题及修订为 NULL，实际分值另存试卷',
  `status`             VARCHAR(16)  NOT NULL DEFAULT 'pending' COMMENT 'pending / approved / rejected',
  `source`             VARCHAR(16)  NOT NULL COMMENT 'ai / manual / import',
  `created_by`         BIGINT UNSIGNED NOT NULL COMMENT '创建人',
  `created_at`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_regulation_status_type` (`regulation_id`, `status`, `type`),
  KEY `idx_version` (`version_id`),
  KEY `idx_question_category_pool` (`category_id`, `status`, `type`, `difficulty`),
  KEY `idx_question_concept` (`concept_id`),
  KEY `idx_question_current_version` (`current_version_id`),
  KEY `idx_question_enabled_pool` (`is_enabled`, `category_id`, `type`, `difficulty`, `current_version_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='试题库';

CREATE TABLE IF NOT EXISTS `question_concept` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `category_id` BIGINT UNSIGNED NOT NULL COMMENT '培训类别',
  `type`        VARCHAR(16) NOT NULL COMMENT 'single / multiple / judgment',
  `name`        VARCHAR(128) NOT NULL COMMENT '考点名称',
  `created_by`  BIGINT UNSIGNED NOT NULL,
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_question_concept_scope` (`category_id`, `type`, `name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='题目考点组';

CREATE TABLE IF NOT EXISTS `question_version` (
  `id`                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `question_id`           BIGINT UNSIGNED NOT NULL,
  `revision`              INT UNSIGNED NOT NULL,
  `category_id`           BIGINT UNSIGNED NULL,
  `difficulty`            VARCHAR(16) NULL COMMENT 'easy / medium / hard；旧捕获版本可 NULL',
  `type`                  VARCHAR(16) NOT NULL COMMENT 'single / multiple / judgment',
  `stem`                  TEXT NOT NULL,
  `options`               JSON NOT NULL,
  `answer`                JSON NOT NULL,
  `analysis`              TEXT NULL,
  `content_schema_version` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `content_json`          JSON NULL,
  `authoring_schema_version` TINYINT UNSIGNED NULL COMMENT '作者原稿 schema；旧版本不回填',
  `authoring_json`        JSON NULL COMMENT '单题 AuthoringBundle；仅管理端读取',
  `score_cents`           INT UNSIGNED NULL COMMENT '历史兼容列；新题及修订为 NULL，实际分值另存试卷',
  `concept_id`            BIGINT UNSIGNED NULL,
  `regulation_id`         BIGINT UNSIGNED NULL,
  `regulation_version_id` BIGINT UNSIGNED NULL,
  `source_page_group`     INT UNSIGNED NULL COMMENT '实际 PDF 页组下标；旧题未知保持 NULL',
  `source_page_start`     INT UNSIGNED NULL COMMENT '实际来源起始页（1-based）',
  `source_page_end`       INT UNSIGNED NULL COMMENT '实际来源结束页（1-based）',
  `source`                VARCHAR(16) NOT NULL COMMENT 'ai / manual / import',
  `status`                VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending / approved / rejected',
  `approved_by`           BIGINT UNSIGNED NULL,
  `approved_at`           DATETIME(3) NULL,
  `reviewed_by`           BIGINT UNSIGNED NULL,
  `reviewed_at`           DATETIME(3) NULL,
  `review_reason`         VARCHAR(1000) NULL,
  `created_by`            BIGINT UNSIGNED NOT NULL,
  `legacy_captured_at`    DATETIME(3) NULL COMMENT '仅表示升级时捕获，不代表历史考试版本',
  `created_at`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_question_version_revision` (`question_id`, `revision`),
  KEY `idx_question_version_candidate` (`category_id`, `type`, `difficulty`, `status`),
  KEY `idx_question_version_regulation` (`regulation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='不可变题目内容版本及审核轨迹';

-- result_json=NULL 只允许事务内占位；成功提交前必须写入完整回执。
CREATE TABLE IF NOT EXISTS `question_authoring_commit` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_id`     BIGINT UNSIGNED NOT NULL,
  `request_id`   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `content_hash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `result_json`  JSON NULL,
  `created_at`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_question_authoring_commit_owner_request` (`owner_id`, `request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='作者原稿提交的持久幂等回执';

CREATE TABLE IF NOT EXISTS `exam_paper` (
  `id`                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `regulation_id`        BIGINT UNSIGNED NULL COMMENT '制度专项卷所属制度；培训卷为 NULL',
  `business_scope`       VARCHAR(16) NOT NULL DEFAULT 'regulation' COMMENT 'regulation / training',
  `mode`                 VARCHAR(16) NOT NULL DEFAULT 'fixed' COMMENT 'fixed / random',
  `category_id`          BIGINT UNSIGNED NULL COMMENT '培训卷类别；制度专项卷为 NULL',
  `requires_learning`    TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '培训卷默认 0；制度专项卷保持 1',
  `required_learning_minutes` INT UNSIGNED NULL,
  `regulation_ids`       JSON NULL COMMENT '培训卷可选制度筛选；空数组表示不过滤',
  `course_ids`           JSON NULL COMMENT '考前学习课程关联，不参与抽题过滤',
  `rule_config`          JSON NULL COMMENT '草稿题型、题量与整数分配置',
  `designer_layout`      JSON NULL COMMENT '管理端 DesignerLayoutV1；旧卷不回填',
  `title`                VARCHAR(128) NOT NULL COMMENT '试卷标题',
  `remark`               VARCHAR(1000) NULL,
  `sort_order`           INT          NOT NULL DEFAULT 0,
  `total_score`          DECIMAL(5,2) NOT NULL DEFAULT 100.00 COMMENT '目标总分，默认100；发布时题目分值合计须一致',
  `pass_score`           DECIMAL(5,2) NOT NULL DEFAULT 60.00 COMMENT '及格线，大于0且不超过目标总分',
  `duration_minutes`     INT          NOT NULL DEFAULT 30 COMMENT '考试限时（分钟）',
  `max_attempts`         INT          NOT NULL DEFAULT 3 COMMENT '最大作答次数（含首次）',
  `partial_credit_ratio` DECIMAL(4,2) NOT NULL DEFAULT 0.50 COMMENT '多选漏选部分分比例 [0,1]',
  `status`               VARCHAR(16)  NOT NULL DEFAULT 'draft' COMMENT 'draft / published；withdrawn / archived 仅历史兼容',
  `created_by`           BIGINT UNSIGNED NOT NULL COMMENT '创建人',
  `updated_by`           BIGINT UNSIGNED NULL,
  `created_at`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_regulation_status` (`regulation_id`, `status`),
  KEY `idx_paper_training_pool` (`category_id`, `business_scope`, `mode`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='试卷';

CREATE TABLE IF NOT EXISTS `paper_question` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `paper_id`    BIGINT UNSIGNED NOT NULL COMMENT '试卷',
  `question_id` BIGINT UNSIGNED NOT NULL COMMENT '题目',
  `question_version_id` BIGINT UNSIGNED NULL COMMENT '培训固定卷选定的当前审核版本；legacy 为 NULL',
  `concept_id` BIGINT UNSIGNED NULL COMMENT '发布前重复考点校验快照',
  `sort`        INT          NOT NULL DEFAULT 0 COMMENT '组卷顺序（乱序基准）',
  `score`       DECIMAL(5,2) NOT NULL COMMENT '本题在本试卷中的分值',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_paper_question` (`paper_id`, `question_id`),
  KEY `idx_question` (`question_id`),
  KEY `idx_paper_question_version` (`question_version_id`),
  KEY `idx_paper_question_concept` (`concept_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='试卷-题目关联';

CREATE TABLE IF NOT EXISTS `paper_release` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `paper_id`          BIGINT UNSIGNED NOT NULL,
  `version_no`        INT UNSIGNED NOT NULL,
  `business_scope`    VARCHAR(16) NOT NULL,
  `mode`              VARCHAR(16) NOT NULL,
  `category_id`       BIGINT UNSIGNED NULL,
  `requires_learning` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `required_learning_minutes` INT UNSIGNED NULL,
  `rule_snapshot`     JSON NOT NULL,
  `regulation_ids`    JSON NULL,
  `course_ids`        JSON NULL,
  `created_by`        BIGINT UNSIGNED NOT NULL,
  `released_at`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_paper_release_version` (`paper_id`, `version_no`),
  KEY `idx_paper_release_category` (`category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='不可变试卷发布版本';

CREATE TABLE IF NOT EXISTS `paper_release_question` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `release_id`          BIGINT UNSIGNED NOT NULL,
  `question_id`         BIGINT UNSIGNED NOT NULL,
  `question_version_id` BIGINT UNSIGNED NOT NULL,
  `concept_id`          BIGINT UNSIGNED NULL,
  `type`                VARCHAR(16) NOT NULL,
  `difficulty`          VARCHAR(16) NOT NULL,
  `score_cents`         INT UNSIGNED NOT NULL,
  `position`            INT UNSIGNED NOT NULL DEFAULT 0,
  `snapshot_json`       JSON NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_release_question_version` (`release_id`, `question_version_id`),
  KEY `idx_release_question_pool` (`release_id`, `difficulty`, `type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='发布时冻结的候选题版本与实际分值';

CREATE TABLE IF NOT EXISTS `exam_assignment` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `paper_id`        BIGINT UNSIGNED NOT NULL,
  `user_id`         BIGINT UNSIGNED NOT NULL,
  `release_id`      BIGINT UNSIGNED NULL,
  `source`          VARCHAR(16) NULL COMMENT 'institution / external；legacy 为 NULL',
  `category_id`     BIGINT UNSIGNED NULL,
  `difficulty`      VARCHAR(16) NOT NULL COMMENT 'easy / medium / hard / mixed / unknown',
  `rule_snapshot`   JSON NOT NULL,
  `snapshot_origin` VARCHAR(32) NOT NULL COMMENT 'release / legacy_start',
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_exam_assignment_paper_user` (`paper_id`, `user_id`),
  KEY `idx_exam_assignment_user` (`user_id`),
  KEY `idx_exam_assignment_release` (`release_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='学员在单场考试内冻结的来源类别难度与规则';

CREATE TABLE IF NOT EXISTS `exam_record` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `paper_id`      BIGINT UNSIGNED NOT NULL COMMENT '试卷',
  `regulation_id` BIGINT UNSIGNED NULL COMMENT '制度冗余快照；培训考试为 NULL',
  `user_id`       BIGINT UNSIGNED NOT NULL COMMENT '考生',
  `assignment_id` BIGINT UNSIGNED NULL COMMENT 'C2 个人考试归属；legacy 记录为 NULL',
  `active_assignment_id` BIGINT UNSIGNED NULL COMMENT '仅进行中记录等于 assignment_id，终态置 NULL',
  `release_id`    BIGINT UNSIGNED NULL COMMENT '发布快照；legacy_start 为 NULL',
  `source`        VARCHAR(16) NULL COMMENT '首次开考冻结的学员来源',
  `category_id`   BIGINT UNSIGNED NULL COMMENT '首次开考冻结的培训类别',
  `difficulty`    VARCHAR(16) NULL COMMENT 'easy / medium / hard / mixed / unknown',
  `rule_snapshot` JSON NULL COMMENT '本场冻结的分值、时长、次数及评分规则',
  `snapshot_origin` VARCHAR(32) NOT NULL DEFAULT 'legacy_unavailable' COMMENT 'release / legacy_start / legacy_unavailable',
  `attempt_no`    INT          NOT NULL DEFAULT 1 COMMENT '第几次作答',
  `status`        VARCHAR(16)  NOT NULL DEFAULT 'in_progress' COMMENT 'in_progress / submitted / passed / failed / timeout',
  `score`         DECIMAL(5,2) NULL COMMENT '得分；in_progress 时为 NULL',
  `started_at`    DATETIME(3)  NOT NULL COMMENT '开考时间',
  `deadline_at`   DATETIME(3)  NOT NULL COMMENT '交卷截止时刻快照（此后不变）',
  `submitted_at`  DATETIME(3)  NULL COMMENT '交卷时间',
  `draft_revision` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '服务端确认草稿版本',
  `draft_payload_hash` CHAR(64) NULL COMMENT '当前确认草稿的规范化哈希',
  `draft_saved_at` DATETIME(3) NULL COMMENT '当前草稿确认时间',
  `submission_method` VARCHAR(16) NULL COMMENT 'manual / timeout；历史未知为 NULL',
  `grading_state` VARCHAR(32) NOT NULL DEFAULT 'not_submitted' COMMENT 'not_submitted / finalized',
  `graded_at` DATETIME(3) NULL COMMENT '最终结算时间；历史未知为 NULL',
  `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_paper_user_attempt` (`paper_id`, `user_id`, `attempt_no`),
  UNIQUE KEY `uk_assignment_attempt` (`assignment_id`, `attempt_no`),
  UNIQUE KEY `uk_active_assignment` (`active_assignment_id`),
  KEY `idx_user_paper_status` (`user_id`, `paper_id`, `status`),
  KEY `idx_regulation_status` (`regulation_id`, `status`),
  KEY `idx_paper_status` (`paper_id`, `status`),
  KEY `idx_status_deadline` (`status`, `deadline_at`),
  KEY `idx_exam_record_release` (`release_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='考试记录';

CREATE TABLE IF NOT EXISTS `exam_record_question` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `record_id`           BIGINT UNSIGNED NOT NULL,
  `question_id`         BIGINT UNSIGNED NOT NULL COMMENT '题目身份，仅作来源追踪',
  `question_version_id` BIGINT UNSIGNED NULL COMMENT '冻结的题目版本；遗留未知可为 NULL',
  `type`                VARCHAR(16) NOT NULL,
  `difficulty`          VARCHAR(16) NOT NULL COMMENT '题目自身难度，遗留未知为 unknown',
  `score_cents`         INT UNSIGNED NOT NULL,
  `position`            INT UNSIGNED NOT NULL COMMENT '本次题面显示顺序',
  `display_to_original` JSON NOT NULL COMMENT '显示选项下标到原始下标的完整映射',
  `snapshot_json`       JSON NOT NULL COMMENT '题干、选项、答案、解析与来源版本事实',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_exam_record_question_position` (`record_id`, `position`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='每次作答冻结的个人题单与显示映射';

CREATE TABLE IF NOT EXISTS `exam_answer` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `exam_record_id` BIGINT UNSIGNED NOT NULL COMMENT '考试记录',
  `question_id`    BIGINT UNSIGNED NOT NULL COMMENT '来源题目；C2 临时 item ID 经 010 恢复',
  `record_question_id` BIGINT UNSIGNED NULL COMMENT '个人题单项；legacy 无题单记录为 NULL',
  `selected`       JSON         NULL COMMENT '考生所选选项（原始下标数组）；NULL/空=未作答',
  `selected_option_ids` JSON NULL COMMENT 'v2 稳定选项 ID；旧记录保持 NULL',
  `is_correct`     TINYINT(1)   NULL COMMENT '1=全对，0=非全对（含漏选），NULL=未作答',
  `gained_score`   DECIMAL(5,2) NULL DEFAULT NULL COMMENT '客观题自动得分；未交卷为 NULL',
  `created_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_record_question` (`exam_record_id`, `question_id`),
  UNIQUE KEY `uk_record_item` (`exam_record_id`, `record_question_id`),
  KEY `idx_question` (`question_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='答题明细';

-- ---------------------------------------------------------------------
-- 5. 受控媒体域（2 张，A4）
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `media_asset` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_id`      BIGINT UNSIGNED NOT NULL COMMENT '业务拥有者；由服务端从身份/管理目标确定',
  `uploaded_by`   BIGINT UNSIGNED NOT NULL COMMENT '上传操作者',
  `purpose`       VARCHAR(32) NOT NULL COMMENT 'avatar / course_cover / video / question / branding',
  `media_kind`    VARCHAR(16) NOT NULL COMMENT 'image / video',
  `original_name` VARCHAR(255) NULL COMMENT '仅展示元数据，不参与路径拼接',
  `mime_type`     VARCHAR(128) NOT NULL,
  `storage_key`   VARCHAR(512) NOT NULL COMMENT '服务端生成的私有相对路径',
  `storage_provider` VARCHAR(16) NOT NULL DEFAULT 'local',
  `cos_bucket` VARCHAR(255) NULL,
  `cos_region` VARCHAR(64) NULL,
  `cos_version_id` VARCHAR(255) NULL,
  `etag` VARCHAR(255) NULL,
  `crc64` VARCHAR(64) NULL,
  `size_bytes`    BIGINT UNSIGNED NOT NULL,
  `sha256`        CHAR(64) NOT NULL,
  `status`        VARCHAR(16) NOT NULL DEFAULT 'processing' COMMENT 'processing / ready / failed；deleting 为内部删除重试墓碑',
  `duration_ms`   BIGINT UNSIGNED NULL COMMENT '视频实际探测时长；图片为 NULL',
  `probe_error`   VARCHAR(512) NULL COMMENT '失败摘要，不含本地路径',
  `created_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_asset_storage_key` (`storage_key`),
  KEY `idx_media_asset_owner_purpose` (`owner_id`, `purpose`),
  KEY `idx_media_asset_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='受控媒体资源';

CREATE TABLE IF NOT EXISTS `media_upload_session` (
  `id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `owner_id` BIGINT UNSIGNED NOT NULL,
  `uploaded_by` BIGINT UNSIGNED NOT NULL,
  `client_request_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_digest` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `purpose` VARCHAR(32) NOT NULL,
  `original_name` VARCHAR(255) NULL,
  `mime_type` VARCHAR(128) NOT NULL,
  `size_bytes` BIGINT UNSIGNED NOT NULL,
  `fingerprint_sha256` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `mode` VARCHAR(16) NOT NULL,
  `part_size` INT UNSIGNED NOT NULL,
  `parallel_limit` TINYINT UNSIGNED NOT NULL DEFAULT '3',
  `staging_locator` JSON NULL,
  `upload_id` VARCHAR(255) NULL,
  `state` VARCHAR(16) NOT NULL DEFAULT 'uploading',
  `expires_at` DATETIME(3) NOT NULL,
  `last_credential_expires_at` DATETIME(3) NULL,
  `claim_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `lease_until` DATETIME(3) NULL,
  `finalize_attempts` TINYINT UNSIGNED NOT NULL DEFAULT '0',
  `candidate_objects` JSON NULL,
  `asset_id` BIGINT UNSIGNED NULL,
  `receipt` JSON NULL,
  `receipt_expires_at` DATETIME(3) NULL,
  `reason_code` VARCHAR(64) NULL,
  `error_message` VARCHAR(512) NULL,
  `finalized_at` DATETIME(3) NULL,
  `cleaned_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_upload_request` (`uploaded_by`, `client_request_id`),
  KEY `idx_media_upload_queue` (`state`, `lease_until`),
  KEY `idx_media_upload_expiry` (`state`, `expires_at`),
  KEY `idx_media_upload_credentials` (`state`, `last_credential_expires_at`),
  KEY `idx_media_upload_receipt` (`state`, `receipt_expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='持久媒体上传会话与请求墓碑';

CREATE TABLE IF NOT EXISTS `media_reference` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `asset_id`   BIGINT UNSIGNED NOT NULL COMMENT 'media_asset.id；应用层维护引用完整性',
  `owner_type` VARCHAR(64) NOT NULL COMMENT '业务归属类型，必须注册 authorizer',
  `owner_id`   BIGINT UNSIGNED NOT NULL COMMENT '业务归属实体 id',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_reference_owner` (`asset_id`, `owner_type`, `owner_id`),
  KEY `idx_media_reference_asset` (`asset_id`),
  KEY `idx_media_reference_owner` (`owner_type`, `owner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='媒体业务引用';

-- ---------------------------------------------------------------------
-- 6. 课程内容域（4 张，B1）
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `training_course` (
  `id`                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title`                 VARCHAR(255) NOT NULL COMMENT '课程标题',
  `category_id`           BIGINT UNSIGNED NOT NULL COMMENT '培训类别',
  `cover_asset_id`        BIGINT UNSIGNED NULL COMMENT 'course_cover 媒体资源',
  `description`           TEXT NULL,
  `regulation_ids`        JSON NULL COMMENT '可选制度信息关联；不构成学习或考试门槛',
  `is_recommended`        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `sort_order`            INT NOT NULL DEFAULT 0,
  `status`                VARCHAR(32) NOT NULL DEFAULT 'draft' COMMENT 'draft / published / offline',
  `created_by`            BIGINT UNSIGNED NOT NULL,
  `published_at`          DATETIME(3) NULL,
  `created_at`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_training_course_category_status` (`category_id`, `status`),
  KEY `idx_training_course_recommended_sort` (`is_recommended`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='培训课程';

CREATE TABLE IF NOT EXISTS `course_chapter` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `course_id`  BIGINT UNSIGNED NOT NULL,
  `title`      VARCHAR(255) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_course_chapter_course_sort` (`course_id`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='课程章节';

CREATE TABLE IF NOT EXISTS `course_lesson` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `course_id`          BIGINT UNSIGNED NOT NULL,
  `chapter_id`         BIGINT UNSIGNED NOT NULL,
  `title`              VARCHAR(255) NOT NULL,
  `lesson_type`        VARCHAR(32) NOT NULL DEFAULT 'video' COMMENT '本期仅 video',
  `is_required`        TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `sort_order`         INT NOT NULL DEFAULT 0,
  `current_version_id` BIGINT UNSIGNED NULL,
  `created_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `deleted_at`         DATETIME(3) NULL COMMENT '逻辑删除时间；版本、媒体引用和学习事实永久保留',
  PRIMARY KEY (`id`),
  KEY `idx_course_lesson_course` (`course_id`),
  KEY `idx_course_lesson_chapter_sort` (`chapter_id`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='课程课时';

CREATE TABLE IF NOT EXISTS `lesson_version` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `lesson_id`   BIGINT UNSIGNED NOT NULL,
  `version_no`  INT UNSIGNED NOT NULL,
  `asset_id`    BIGINT UNSIGNED NOT NULL COMMENT 'video 媒体资源',
  `duration_ms` BIGINT UNSIGNED NOT NULL COMMENT '服务端媒体探测时长快照',
  `created_by`  BIGINT UNSIGNED NOT NULL,
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_lesson_version_number` (`lesson_id`, `version_no`),
  KEY `idx_lesson_version_asset` (`asset_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='视频课时不可变内容版本';

-- ---------------------------------------------------------------------
-- 7. 视频学习域（2 张，B2）
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `video_learning_record` (
  `id`                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`               BIGINT UNSIGNED NOT NULL,
  `lesson_version_id`     BIGINT UNSIGNED NOT NULL,
  `duration_ms`           BIGINT UNSIGNED NOT NULL COMMENT '不可变课时版本时长快照',
  `credited_ms`           BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '有效播放时长，可含重复观看',
  `coverage_intervals`    JSON NOT NULL COMMENT '已确认去重播放区间，毫秒',
  `coverage_ms`           BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '去重覆盖毫秒',
  `confirmed_position_ms` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '最远已确认断点',
  `is_completed`          TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '覆盖达到 95%',
  `completed_at`          DATETIME(3) NULL,
  `last_learn_at`         DATETIME(3) NULL,
  `created_at`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_video_learning_record_user_version` (`user_id`, `lesson_version_id`),
  KEY `idx_video_learning_record_user_completed` (`user_id`, `is_completed`),
  KEY `idx_video_learning_record_version` (`lesson_version_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='学员视频版本学习汇总';

CREATE TABLE IF NOT EXISTS `video_learning_session` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `record_id`          BIGINT UNSIGNED NOT NULL,
  `user_id`            BIGINT UNSIGNED NOT NULL,
  `lesson_version_id`  BIGINT UNSIGNED NOT NULL,
  `active_user_id`     BIGINT UNSIGNED NULL COMMENT '活动所有者；结束后置 NULL',
  `started_at`         DATETIME(3) NOT NULL,
  `last_heartbeat_at`  DATETIME(3) NOT NULL,
  `ended_at`           DATETIME(3) NULL,
  `last_seq`           INT UNSIGNED NOT NULL DEFAULT 0,
  `anchor_position_ms` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `anchor_state`       VARCHAR(32) NOT NULL DEFAULT 'playing' COMMENT 'playing / paused / buffering / background / ended',
  `credited_ms`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_video_learning_session_active_user` (`active_user_id`),
  KEY `idx_video_learning_session_user_started` (`user_id`, `started_at`),
  KEY `idx_video_learning_session_last_heartbeat` (`last_heartbeat_at`),
  KEY `idx_video_learning_session_record` (`record_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='可恢复视频学习会话';

-- ---------------------------------------------------------------------
-- 8. 后台公共配置域（4 张，含字典分类元数据）
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `sys_menu` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `parent_id` BIGINT UNSIGNED NULL,
  `name` VARCHAR(128) NOT NULL,
  `type` VARCHAR(16) NOT NULL COMMENT 'directory / menu / button',
  `route_path` VARCHAR(255) NULL COMMENT '只能映射前端注册路由；button 必须为空',
  `permission_code` VARCHAR(128) NULL COMMENT '只能映射服务端权限白名单；directory 必须为空',
  `icon` VARCHAR(64) NULL,
  `sort` INT NOT NULL DEFAULT 0,
  `status` TINYINT NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_sys_menu_parent_sort` (`parent_id`, `sort`),
  KEY `idx_sys_menu_permission` (`permission_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='后台菜单与按钮目录';

CREATE TABLE IF NOT EXISTS `sys_dictionary_type` (
  `type` VARCHAR(64) NOT NULL,
  `label` VARCHAR(128) NOT NULL,
  `description` VARCHAR(255) NULL,
  `sort` INT NOT NULL DEFAULT 1000,
  `is_system` TINYINT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`type`),
  UNIQUE KEY `uk_sys_dictionary_type_label` (`label`),
  KEY `idx_sys_dictionary_type_sort` (`sort`, `type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='字典分类元数据；内置分类仅名称与描述可编辑';

CREATE TABLE IF NOT EXISTS `sys_dictionary` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `type` VARCHAR(64) NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `label` VARCHAR(128) NOT NULL,
  `sort` INT NOT NULL DEFAULT 0,
  `status` TINYINT NOT NULL DEFAULT 1,
  `is_system` TINYINT NOT NULL DEFAULT 0 COMMENT '1=业务固定枚举，只读',
  `remark` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sys_dictionary_type_code` (`type`, `code`),
  KEY `idx_sys_dictionary_type_sort` (`type`, `sort`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='显示字典；业务固定枚举不由此表改变语义';

CREATE TABLE IF NOT EXISTS `site_setting` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `setting_key` VARCHAR(64) NOT NULL,
  `value_json` JSON NULL,
  `updated_by` BIGINT UNSIGNED NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_site_setting_key` (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='站点公开展示配置白名单';

INSERT INTO `sys_permission` (`code`, `name`) VALUES
  ('exam_records:read', '查看考试记录'),
  ('administrators:create', '新增管理员'),
  ('administrators:update', '修改管理员'),
  ('administrators:delete', '删除管理员'),
  ('administrators:reset_password', '重置管理员密码'),
  ('roles:create', '新增角色'),
  ('roles:update', '修改角色'),
  ('roles:delete', '删除角色'),
  ('roles:permissions', '设置角色权限'),
  ('menus:read', '查看菜单'),
  ('menus:create', '新增菜单'),
  ('menus:update', '修改菜单'),
  ('menus:delete', '删除菜单')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

INSERT INTO `sys_dictionary_type` (`type`, `label`, `sort`, `is_system`) VALUES
  ('question_type', '试题类型', 0, 1),
  ('difficulty', '题目难度', 1, 1),
  ('learner_source', '学员来源', 2, 1),
  ('paper_status', '试卷状态', 3, 1),
  ('exam_status', '考试状态', 4, 1),
  ('question_status', '题目状态', 5, 1),
  ('regulation_status', '制度状态', 6, 1)
ON DUPLICATE KEY UPDATE `type` = `type`;

INSERT INTO `sys_dictionary` (`type`, `code`, `label`, `sort`, `status`, `is_system`, `remark`) VALUES
  ('learner_source','institution','本机构学员',10,1,1,'业务固定枚举'),
  ('learner_source','external','外来学员',20,1,1,'业务固定枚举'),
  ('difficulty','easy','初级',10,1,1,'业务固定枚举'),
  ('difficulty','medium','中级',20,1,1,'业务固定枚举'),
  ('difficulty','hard','高级',30,1,1,'业务固定枚举'),
  ('question_type','single','单选题',10,1,1,'业务固定枚举'),
  ('question_type','multiple','多选题',20,1,1,'业务固定枚举'),
  ('question_type','judgment','判断题',30,1,1,'业务固定枚举'),
  ('regulation_status','draft','草稿',10,1,1,'业务固定枚举'),
  ('regulation_status','published','已发布',20,1,1,'业务固定枚举'),
  ('regulation_status','archived','已归档',30,1,1,'业务固定枚举'),
  ('paper_status','draft','草稿',10,1,1,'业务固定枚举'),
  ('paper_status','published','已发布',20,1,1,'业务固定枚举'),
  ('paper_status','archived','已归档',30,1,1,'业务固定枚举'),
  ('question_status','pending','待审核',10,1,1,'业务固定枚举'),
  ('question_status','approved','已通过',20,1,1,'业务固定枚举'),
  ('question_status','rejected','已驳回',30,1,1,'业务固定枚举'),
  ('exam_status','in_progress','进行中',10,1,1,'业务固定枚举'),
  ('exam_status','submitted','已交卷',20,1,1,'业务固定枚举'),
  ('exam_status','passed','已通过',30,1,1,'业务固定枚举'),
  ('exam_status','failed','未通过',40,1,1,'业务固定枚举'),
  ('exam_status','timeout','超时交卷',50,1,1,'业务固定枚举')
ON DUPLICATE KEY UPDATE `label` = VALUES(`label`), `sort` = VALUES(`sort`), `status` = 1, `is_system` = 1, `remark` = VALUES(`remark`);

INSERT INTO `site_setting` (`id`, `setting_key`, `value_json`, `updated_by`) VALUES
  (1,'logo_asset_id',NULL,NULL),
  (2,'banners','[]',NULL)
ON DUPLICATE KEY UPDATE `id` = `id`;

INSERT INTO `sys_permission` (`code`, `name`) VALUES
  ('exam_records:read', '查看考试记录')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

INSERT INTO `sys_menu` (`id`, `parent_id`, `name`, `type`, `route_path`, `permission_code`, `icon`, `sort`, `status`) VALUES
  (1,NULL,'学习管理','directory',NULL,NULL,'Reading',20,1),
  (2,NULL,'系统设置','directory',NULL,NULL,'Setting',50,1),
  (3,NULL,'考试管理','directory',NULL,NULL,'Tickets',30,1),
  (11,3,'试题管理','menu','/admin/questions',NULL,'EditPen',10,1),
  (12,3,'试卷管理','menu','/admin/papers','papers:read','Tickets',20,1),
  (13,1,'统计报表','menu','/admin/statistics','statistics:read','DataAnalysis',90,0),
  (16,1,'学员管理','menu','/admin/students','students:read','UserFilled',20,1),
  (17,1,'培训类别','menu','/admin/training-categories','training_categories:read','CollectionTag',10,1),
  (19,1,'课程管理','menu','/admin/courses',NULL,'Notebook',30,1),
  (18,2,'AI 服务配置','menu','/admin/ai-config',NULL,'Cpu',10,1),
  (20,2,'管理员','menu','/admin/administrators','administrators:read','UserFilled',20,1),
  (21,2,'角色权限','menu','/admin/roles','roles:read','SetUp',30,1),
  (22,2,'在线会话','menu','/admin/sessions','sessions:read','Monitor',70,1),
  (23,2,'菜单配置','menu','/admin/system/menus','menus:read','Menu',60,1),
  (24,2,'字典配置','menu','/admin/system/dictionaries','system_settings:read','Notebook',50,1),
  (25,2,'网站配置','menu','/admin/system/site-settings','system_settings:read','Picture',40,1),
  (26,2,'审计日志','menu','/admin/system/audit-logs','system_settings:read','DocumentChecked',80,1)
ON DUPLICATE KEY UPDATE `id` = `id`;

-- 管理员、角色与菜单使用独立按钮权限；已有相同父级/权限的按钮保持原配置。
INSERT IGNORE INTO sys_menu (parent_id, name, type, route_path, permission_code, icon, sort, status)
SELECT id, '新增管理员', 'button', NULL, 'administrators:create', NULL, 10, 1 FROM sys_menu WHERE type='menu' AND route_path='/admin/administrators' AND id NOT IN (SELECT parent_id FROM sys_menu WHERE type='button' AND permission_code='administrators:create' AND parent_id IS NOT NULL)
UNION ALL
SELECT id, '修改管理员', 'button', NULL, 'administrators:update', NULL, 20, 1 FROM sys_menu WHERE type='menu' AND route_path='/admin/administrators' AND id NOT IN (SELECT parent_id FROM sys_menu WHERE type='button' AND permission_code='administrators:update' AND parent_id IS NOT NULL)
UNION ALL
SELECT id, '删除管理员', 'button', NULL, 'administrators:delete', NULL, 30, 1 FROM sys_menu WHERE type='menu' AND route_path='/admin/administrators' AND id NOT IN (SELECT parent_id FROM sys_menu WHERE type='button' AND permission_code='administrators:delete' AND parent_id IS NOT NULL)
UNION ALL
SELECT id, '重置管理员密码', 'button', NULL, 'administrators:reset_password', NULL, 40, 1 FROM sys_menu WHERE type='menu' AND route_path='/admin/administrators' AND id NOT IN (SELECT parent_id FROM sys_menu WHERE type='button' AND permission_code='administrators:reset_password' AND parent_id IS NOT NULL)
UNION ALL
SELECT id, '新增角色', 'button', NULL, 'roles:create', NULL, 60, 1 FROM sys_menu WHERE type='menu' AND route_path='/admin/roles' AND id NOT IN (SELECT parent_id FROM sys_menu WHERE type='button' AND permission_code='roles:create' AND parent_id IS NOT NULL)
UNION ALL
SELECT id, '修改角色', 'button', NULL, 'roles:update', NULL, 70, 1 FROM sys_menu WHERE type='menu' AND route_path='/admin/roles' AND id NOT IN (SELECT parent_id FROM sys_menu WHERE type='button' AND permission_code='roles:update' AND parent_id IS NOT NULL)
UNION ALL
SELECT id, '删除角色', 'button', NULL, 'roles:delete', NULL, 80, 1 FROM sys_menu WHERE type='menu' AND route_path='/admin/roles' AND id NOT IN (SELECT parent_id FROM sys_menu WHERE type='button' AND permission_code='roles:delete' AND parent_id IS NOT NULL)
UNION ALL
SELECT id, '设置角色权限', 'button', NULL, 'roles:permissions', NULL, 90, 1 FROM sys_menu WHERE type='menu' AND route_path='/admin/roles' AND id NOT IN (SELECT parent_id FROM sys_menu WHERE type='button' AND permission_code='roles:permissions' AND parent_id IS NOT NULL)
UNION ALL
SELECT id, '新增菜单', 'button', NULL, 'menus:create', NULL, 100, 1 FROM sys_menu WHERE type='menu' AND route_path='/admin/system/menus' AND id NOT IN (SELECT parent_id FROM sys_menu WHERE type='button' AND permission_code='menus:create' AND parent_id IS NOT NULL)
UNION ALL
SELECT id, '修改菜单', 'button', NULL, 'menus:update', NULL, 110, 1 FROM sys_menu WHERE type='menu' AND route_path='/admin/system/menus' AND id NOT IN (SELECT parent_id FROM sys_menu WHERE type='button' AND permission_code='menus:update' AND parent_id IS NOT NULL)
UNION ALL
SELECT id, '删除菜单', 'button', NULL, 'menus:delete', NULL, 120, 1 FROM sys_menu WHERE type='menu' AND route_path='/admin/system/menus' AND id NOT IN (SELECT parent_id FROM sys_menu WHERE type='button' AND permission_code='menus:delete' AND parent_id IS NOT NULL);

INSERT INTO `sys_menu` (`parent_id`, `name`, `type`, `route_path`, `permission_code`, `icon`, `sort`, `status`)
SELECT 3, '试题导入', 'menu', '/admin/questions/import', 'questions:write', 'Upload', 30, 1
FROM `sys_menu` WHERE `id` = 3 AND `type` = 'directory'
  AND NOT EXISTS (SELECT 1 FROM `sys_menu` WHERE `route_path` = '/admin/questions/import');

INSERT INTO `sys_menu` (`parent_id`, `name`, `type`, `route_path`, `permission_code`, `icon`, `sort`, `status`)
SELECT 3, '考试记录', 'menu', '/admin/exam-records', 'exam_records:read', 'DocumentChecked', 40, 1
FROM `sys_menu` WHERE `id` = 3 AND `type` = 'directory'
  AND NOT EXISTS (SELECT 1 FROM `sys_menu` WHERE `route_path` = '/admin/exam-records');

INSERT INTO `sys_menu` (`parent_id`, `name`, `type`, `route_path`, `permission_code`, `icon`, `sort`, `status`)
SELECT NULL, '业务首页', 'menu', '/admin/dashboard', NULL, 'Grid', 10, 1
WHERE EXISTS (SELECT 1 FROM `sys_menu` WHERE `id` = 1 AND `type` = 'directory')
  AND NOT EXISTS (SELECT 1 FROM `sys_menu` WHERE `route_path` = '/admin/dashboard');

INSERT INTO `sys_menu` (`parent_id`, `name`, `type`, `route_path`, `permission_code`, `icon`, `sort`, `status`)
SELECT NULL, '统计分析', 'menu', '/admin/training-statistics', 'statistics:read', 'DataAnalysis', 40, 1
WHERE EXISTS (SELECT 1 FROM `sys_menu` WHERE `id` = 1 AND `type` = 'directory')
  AND NOT EXISTS (SELECT 1 FROM `sys_menu` WHERE `route_path` = '/admin/training-statistics');

-- ---------------------------------------------------------------------
-- 8. 迁移元数据（由 database/migrate.mjs 管理；不属于业务表数量）
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `schema_migration` (
  `migration_id`  VARCHAR(128) NOT NULL,
  `checksum`      CHAR(64)     NOT NULL,
  `status`        VARCHAR(16)  NOT NULL DEFAULT 'applied' COMMENT 'applying / applied / failed',
  `started_at`    DATETIME(3)  NULL,
  `applied_at`   DATETIME(3)  NULL,
  `attempts`      INT          NOT NULL DEFAULT 0,
  `error_message` TEXT         NULL,
  `progress`      JSON         NULL COMMENT '已验证完成的稳定 step id 数组',
  PRIMARY KEY (`migration_id`),
  KEY `idx_schema_migration_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='受控数据库迁移注册表';
