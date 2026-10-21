# ADR 0002：文献身份与阅读文件身份分离

- 状态：已接受（Phase 2 数据模型）
- 日期：2026-10-21
- 依据：工程计划 §5.1、§9 Phase 2；ADR 0001 第 5 条

## 背景

Readest 的 `books` 用 `(user_id, book_hash)` 标识阅读条目，其中 `book_hash` 来自文件内容；`files.id` 则标识云端存储记录。一篇论文的原文、译文、补充材料或修订版不应因为文件字节不同而失去共同的文献身份。直接改动现有 `book_hash` 会牵动阅读位置、笔记和同步协议。

## 决定

1. `scholar_documents.id` 是稳定的逻辑文献 UUID，与文件哈希和 `files.id` 独立；所有新表都带 `user_id`。
2. `scholar_document_books` 将一个或多个现有阅读条目映射到文献；每个 `(user_id, book_hash)` 至多属于一篇文献。`scholar_document_files` 将一个或多个云端文件 UUID 映射到文献，并记录 `original`、`translation`、`supplement` 或 `version` 角色；每个文件只属于一篇文献。
3. 复合外键 `(user_id, document_id)`、`(user_id, book_hash)`、`(user_id, file_id)` 与 RLS 同时约束所有权。匿名角色无表权限；已认证角色只可读写自己的行。客户端未来可用现有 Supabase/PostgREST 访问这些表，无须第二套身份服务。
4. 迁移给当前未删除的书籍各分配一个文献 UUID；仅在路径、格式和账户均符合现有 Readest 正文文件布局时自动关联云端文件。封面和不明布局不猜测类型。当前阅读、笔记、云端文件下载及同步键不变。

## 后果与后续

- 本次建立并回填服务端身份关系；**新导入书籍尚未自动创建文献关系**，客户端创建/关联 API、跨端同步、文献合并与去重提示需后续实现。不能仅凭此迁移宣称 Phase 2 的文献/文件身份验收完成。
- 本地或第三方文件同步中的书籍不在服务器 `files` 表中，需由客户端后续创建关系。已删除书籍不回填；硬删除阅读条目会级联移除其 `scholar_document_books` 映射，但文献和其他文件仍保留，清理语义需在文献管理操作中确定。
- 迁移只增加表、索引和记录。回滚时先停止新客户端对这三张表的写入，备份后按 `scholar_document_files` → `scholar_document_books` → `scholar_documents` 的顺序删除；不改变原有 `books` 或 `files` 行。正式环境的数据删除需单独授权。
