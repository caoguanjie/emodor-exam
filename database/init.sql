-- =====================================================================
-- EmodorRuleExam 制度学习及考试系统 · 数据库初始化脚本
-- 依据 docs/design/03-数据库设计.md 逐字建 legacy、A2 培训身份、A3 权限/会话及 A4 媒体业务表（当前 21 张，InnoDB + utf8mb4）
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
  `status`        TINYINT      NOT NULL DEFAULT 1 COMMENT '1=启用（在职），0=停用',
  `auth_version`  INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '认证世代；密码/身份/管理权限变更递增',
  `force_password_change` TINYINT NOT NULL DEFAULT 0 COMMENT '1=当前口令必须改密；与登录统计分离',
  `login_count`   INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '真实密码成功登录次数；refresh 不计入',
  `last_login_at` DATETIME(3)  NULL COMMENT '最后一次真实密码登录时间',
  `last_login_ip` VARCHAR(64)  NULL COMMENT '最后一次真实密码登录来源 IP',
  `roles_configured` TINYINT NOT NULL DEFAULT 0 COMMENT '1=已显式配置业务角色（含清空）',
  `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`),
  UNIQUE KEY `uk_employee_no` (`employee_no`),
  KEY `idx_department_status` (`department_id`, `status`),
  KEY `idx_training_identity` (`category_id`, `source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='员工账号';

CREATE TABLE IF NOT EXISTS `sys_role` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`       VARCHAR(64)  NOT NULL COMMENT '角色代码，单家机构内唯一',
  `name`       VARCHAR(128) NOT NULL COMMENT '角色名称',
  `is_system`  TINYINT      NOT NULL DEFAULT 0 COMMENT '1=系统角色，不可删除',
  `status`     TINYINT      NOT NULL DEFAULT 1 COMMENT '1=启用，0=停用',
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sys_role_code` (`code`),
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
  `current_version_id` BIGINT UNSIGNED NULL COMMENT '当前题目版本；旧题首次编辑/审核时捕获',
  `type`               VARCHAR(16)  NOT NULL COMMENT 'single / multiple / judgment / image',
  `stem`               TEXT         NOT NULL COMMENT '题干',
  `options`            JSON         NOT NULL COMMENT '选项数组 [{key,text}]',
  `answer`             JSON         NOT NULL COMMENT '正确答案（选项下标数组）',
  `analysis`           TEXT         NULL COMMENT '答案解析',
  `rubric`             TEXT         NULL COMMENT '图片题评分参考；其他题为 NULL',
  `score`              DECIMAL(5,2) NOT NULL COMMENT '题库建议分值；考试实际分值另存',
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
  KEY `idx_question_current_version` (`current_version_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='试题库';

CREATE TABLE IF NOT EXISTS `question_concept` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `category_id` BIGINT UNSIGNED NOT NULL COMMENT '培训类别',
  `type`        VARCHAR(16) NOT NULL COMMENT 'single / multiple / judgment / image',
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
  `type`                  VARCHAR(16) NOT NULL COMMENT 'single / multiple / judgment / image',
  `stem`                  TEXT NOT NULL,
  `options`               JSON NOT NULL,
  `answer`                JSON NOT NULL,
  `analysis`              TEXT NULL,
  `rubric`                TEXT NULL,
  `score_cents`           INT UNSIGNED NOT NULL COMMENT '题库建议分值，整数分；考试实际分值另存',
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

CREATE TABLE IF NOT EXISTS `exam_paper` (
  `id`                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `regulation_id`        BIGINT UNSIGNED NOT NULL COMMENT '所属制度',
  `title`                VARCHAR(128) NOT NULL COMMENT '试卷标题',
  `total_score`          DECIMAL(5,2) NOT NULL DEFAULT 100.00 COMMENT '总分，固定 100 分制',
  `pass_score`           DECIMAL(5,2) NOT NULL DEFAULT 60.00 COMMENT '及格线（(0,100]）',
  `duration_minutes`     INT          NOT NULL DEFAULT 30 COMMENT '考试限时（分钟）',
  `max_attempts`         INT          NOT NULL DEFAULT 3 COMMENT '最大作答次数（含首次）',
  `partial_credit_ratio` DECIMAL(4,2) NOT NULL DEFAULT 0.50 COMMENT '多选漏选部分分比例 [0,1]',
  `status`               VARCHAR(16)  NOT NULL DEFAULT 'draft' COMMENT 'draft / published / archived',
  `created_by`           BIGINT UNSIGNED NOT NULL COMMENT '创建人',
  `created_at`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_regulation_status` (`regulation_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='试卷';

CREATE TABLE IF NOT EXISTS `paper_question` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `paper_id`    BIGINT UNSIGNED NOT NULL COMMENT '试卷',
  `question_id` BIGINT UNSIGNED NOT NULL COMMENT '题目',
  `sort`        INT          NOT NULL DEFAULT 0 COMMENT '组卷顺序（乱序基准）',
  `score`       DECIMAL(5,2) NOT NULL COMMENT '本题在本试卷中的分值',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_paper_question` (`paper_id`, `question_id`),
  KEY `idx_question` (`question_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='试卷-题目关联';

CREATE TABLE IF NOT EXISTS `exam_record` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `paper_id`      BIGINT UNSIGNED NOT NULL COMMENT '试卷',
  `regulation_id` BIGINT UNSIGNED NOT NULL COMMENT '制度（冗余快照，服务统计）',
  `user_id`       BIGINT UNSIGNED NOT NULL COMMENT '考生',
  `attempt_no`    INT          NOT NULL DEFAULT 1 COMMENT '第几次作答',
  `status`        VARCHAR(16)  NOT NULL DEFAULT 'in_progress' COMMENT 'in_progress / submitted / passed / failed / timeout',
  `score`         DECIMAL(5,2) NULL COMMENT '得分；in_progress 时为 NULL',
  `started_at`    DATETIME(3)  NOT NULL COMMENT '开考时间',
  `deadline_at`   DATETIME(3)  NOT NULL COMMENT '交卷截止时刻快照（此后不变）',
  `submitted_at`  DATETIME(3)  NULL COMMENT '交卷时间',
  `switch_count`  INT          NOT NULL DEFAULT 0 COMMENT '切屏次数',
  `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_paper_user_attempt` (`paper_id`, `user_id`, `attempt_no`),
  KEY `idx_user_paper_status` (`user_id`, `paper_id`, `status`),
  KEY `idx_regulation_status` (`regulation_id`, `status`),
  KEY `idx_paper_status` (`paper_id`, `status`),
  KEY `idx_status_deadline` (`status`, `deadline_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='考试记录';

CREATE TABLE IF NOT EXISTS `exam_answer` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `exam_record_id` BIGINT UNSIGNED NOT NULL COMMENT '考试记录',
  `question_id`    BIGINT UNSIGNED NOT NULL COMMENT '题目',
  `selected`       JSON         NULL COMMENT '考生所选选项（原始下标数组）；NULL/空=未作答',
  `is_correct`     TINYINT(1)   NULL COMMENT '1=全对，0=非全对（含漏选），NULL=未作答',
  `gained_score`   DECIMAL(5,2) NOT NULL DEFAULT 0.00 COMMENT '本题实得分',
  `created_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_record_question` (`exam_record_id`, `question_id`),
  KEY `idx_question` (`question_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='答题明细';

-- ---------------------------------------------------------------------
-- 5. 受控媒体域（2 张，A4）
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `media_asset` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_id`      BIGINT UNSIGNED NOT NULL COMMENT '业务拥有者；由服务端从身份/管理目标确定',
  `uploaded_by`   BIGINT UNSIGNED NOT NULL COMMENT '上传操作者',
  `purpose`       VARCHAR(32) NOT NULL COMMENT 'avatar / course_cover / video / question / answer（仅内部）/ branding',
  `media_kind`    VARCHAR(16) NOT NULL COMMENT 'image / video',
  `original_name` VARCHAR(255) NULL COMMENT '仅展示元数据，不参与路径拼接',
  `mime_type`     VARCHAR(128) NOT NULL,
  `storage_key`   VARCHAR(512) NOT NULL COMMENT '服务端生成的私有相对路径',
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
-- 6. 迁移元数据（由 database/migrate.mjs 管理；不属于业务表数量）
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
