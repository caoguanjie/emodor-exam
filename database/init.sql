-- =====================================================================
-- RuleExam 制度学习及考试系统 · 数据库初始化脚本
-- 依据 docs/design/03-数据库设计.md 逐字建表（12 张表，InnoDB + utf8mb4）
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
  `role`          VARCHAR(32)  NOT NULL DEFAULT 'employee' COMMENT 'super_admin / regulation_admin / employee',
  `phone`         VARCHAR(20)  NULL,
  `email`         VARCHAR(128) NULL,
  `status`        TINYINT      NOT NULL DEFAULT 1 COMMENT '1=启用（在职），0=停用',
  `last_login_at` DATETIME(3)  NULL COMMENT '最后登录时间；NULL=当前口令从未成功登录（强制改密标记）',
  `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`),
  UNIQUE KEY `uk_employee_no` (`employee_no`),
  KEY `idx_department_status` (`department_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='员工账号';

-- ---------------------------------------------------------------------
-- 2. 制度域（3 张）
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
-- 4. 考试域（5 张）
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `question` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `regulation_id` BIGINT UNSIGNED NOT NULL COMMENT '所属制度',
  `version_id`    BIGINT UNSIGNED NOT NULL COMMENT '出题依据的制度版本',
  `type`          VARCHAR(16)  NOT NULL COMMENT 'single / multiple',
  `stem`          TEXT         NOT NULL COMMENT '题干',
  `options`       JSON         NOT NULL COMMENT '选项数组 [{key,text}]',
  `answer`        JSON         NOT NULL COMMENT '正确答案（选项下标数组）',
  `analysis`      TEXT         NULL COMMENT '答案解析',
  `score`         DECIMAL(5,2) NOT NULL COMMENT '题库默认分值',
  `status`        VARCHAR(16)  NOT NULL DEFAULT 'pending' COMMENT 'pending / approved / rejected',
  `source`        VARCHAR(16)  NOT NULL COMMENT 'ai / manual',
  `created_by`    BIGINT UNSIGNED NOT NULL COMMENT '创建人',
  `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_regulation_status_type` (`regulation_id`, `status`, `type`),
  KEY `idx_version` (`version_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='试题库';

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
