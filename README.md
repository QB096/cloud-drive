# Rain Drive — 把 RainS3 对象存储改造成你的私人云盘

一个零依赖数据库、直接跑在对象存储上的**个人云盘 Web 应用**：把 S3 兼容的桶（如 RainS3 的 `qb01`）当作文件系统，用浏览器上传 / 下载 / 预览 / 分享 / 回收站，像用百度网盘一样用你的对象存储。

> 数据全部存在你的桶里，本应用只是「浏览器 + 存储」之间的薄壳，不额外存任何中转数据。

## 功能

- 📂 目录浏览、面包屑导航、整盘搜索
- ⬆️ 多文件上传、文件夹上传（保持目录结构）、拖拽上传、上传进度条
- ⬇️ 单文件下载、**文件夹打包 zip 下载**
- 👁 预览：图片、视频/音频、PDF、文本/代码
- 🔗 分享链接：文件生成**预签名链接**；文件夹生成 **zip 打包分享链接**；可选有效期（1小时/1天/3天/7天），任何拿到链接的人可直接下载
- ✏️ 重命名、移动到任意目录
- 🗑 回收站：删除进回收站，支持恢复 / 彻底删除 / 清空
- 📊 顶部显示已用存储与文件数量
- 🔑 可选访问口令登录

## 快速开始

```bash
cd cloud-drive
npm install
npm start          # 默认监听 http://127.0.0.1:8080
```

打开 `http://127.0.0.1:8080` 即可使用。

## 配置（.env）

```ini
# RainS3 连接信息（已在 .env 中按你的实例填好）
S3_ENDPOINT=https://cn-nb1.rains3.com
S3_REGION=cn-nb1
S3_ACCESS_KEY=你的AccessKey
S3_SECRET_KEY=你的SecretKey
S3_BUCKET=qb01

# 应用
PORT=8080
APP_NAME=我的云盘

# 访问口令：留空 = 不登录（仅建议本机/内网）。远程访问务必设置！
APP_PASSWORD=
SESSION_SECRET=   # 留空则每次启动随机生成，重启后需重新登录

# 分享链接默认有效期（秒）
SHARE_EXPIRES=604800
```

## 局域网 / 手机访问

当前已在 `.env` 里配置为局域网可用（`HOST=0.0.0.0`）并设了访问口令（`APP_PASSWORD`）。直接用手机（需和电脑同一局域网）访问：

```
http://<你的局域网IP>:8080
```

例如本机以太网 IP 为 `10.10.10.193`，则手机访问 `http://10.10.10.193:8080`，用 `.env` 里的 `APP_PASSWORD` 登录。

> 已在 Windows 防火墙放行 TCP 8080。若换了网段，重新查一下本机 IP：命令行 `ipconfig` 找“以太网”地址即可。
> ⚠️ 安全提示：`S3_SECRET_KEY` 是敏感凭证，`.env` 已加入 `.gitignore`，请勿提交到公开仓库。若觉得应用不再安全，请在控制台更新 Access Key / Secret Key。

## 目录结构

```
cloud-drive/
├─ server.js          # 入口：Express + 静态页面
├─ lib/
│  ├─ s3.js           # S3 客户端（path-style、S3 兼容配置）
│  ├─ storage.js      # 文件系统式存储操作（list/mkdir/move/trash/zip/…）
│  └─ util.js         # 路径 / mime / 字节格式化
├─ routes/api.js      # REST API + 可选登录
└─ public/            # 前端（原生 JS，无构建）
```

## API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/login` | 登录（返回会话 cookie） |
| GET  | `/api/config` | 应用配置（桶名、是否需密码） |
| GET  | `/api/list?path=` | 列目录 |
| GET  | `/api/search?q=` | 全盘搜索 |
| GET  | `/api/usage` | 已用存储 / 数量 |
| PUT  | `/api/upload?path=&filename=` | 原始流上传 |
| GET  | `/api/download?path=` | 下载（附件） |
| GET  | `/api/preview?path=` | 预览（内联流） |
| GET  | `/api/download-zip?path=` | 文件夹打包 zip |
| POST | `/api/mkdir` `{path}` | 新建文件夹 |
| POST | `/api/rename` `{path,newName}` | 重命名 / 移动 |
| POST | `/api/move` `{from,to}` | 移动 |
| POST | `/api/trash` `{path}` | 移到回收站 |
| GET  | `/api/trash` | 回收站列表 |
| POST | `/api/trash/restore` `{ts}` | 恢复 |
| POST | `/api/trash/delete` `{ts}` | 彻底删除 |
| POST | `/api/trash/empty` | 清空回收站 |
| GET  | `/api/share?path=` | 生成预签名分享链接 |

## 说明与限制

- 文件夹在 S3 里是“以 `/` 结尾的零字节占位对象”，本应用会自动识别、隐藏占位、并按目录树展示。
- 移动 / 重命名 / 回收站是通过**复制 + 删除**实现的（兼容所有 S3 实现），移动大文件较慢属正常。
- 详情页显示的本桶“套餐 / 计费”请在 RainS3 控制台查看，本应用只统计桶内对象的实际用量。
