# 🚀 Goga Blog API

The backend core for **Goga Blog**, a robust and modern blogging platform. This RESTful API handles user authentication, post management, real-time commenting, and secure media uploads.

## 🛠 Tech Stack

*   **Runtime**: Node.js
*   **Framework**: Express.js
*   **Database**: MongoDB (via Mongoose ODM)
*   **Authentication**: JSON Web Tokens (JWT) & Bcryptjs
*   **File Handling**: Multer & Cloudinary (Signed Uploads)
*   **Email Services**: Nodemailer (SMTP)
*   **Validation**: Validator & Leo-Profanity (Username filtering)
*   **Utilities**: Morgan (Logging), CORS, Cookie-parser, Sharp (Image processing)

## ⚙️ Prerequisites

*   **Node.js** (v16.x or higher)
*   **npm** or **yarn**
*   **MongoDB Atlas** account or local MongoDB instance
*   **Cloudinary** account (for media storage)
*   **Gmail/SMTP** credentials (for password recovery)

## 🚀 Local Setup & Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/gogagureshidze/gogablog-api.git
    cd gogablog-api/server
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure Environment Variables:**
    Create a `.env` file in the root directory based on the template below.

4.  **Start the server:**
    ```bash
    # Development mode (with nodemon)
    npm run dev

    # Production mode
    npm start
    ```

## 🔐 Environment Variables

Create a `.env` file and populate it with your credentials:

```env
PORT=4000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_super_secret_jwt_key
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
EMAIL=your_gmail@gmail.com
EMAIL_PASSWORD=your_app_specific_password
NODE_ENV=development
```

## 📑 API Documentation

### 👤 User Authentication
| Method | Route | Description | Body Parameters |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/user/register` | Create a new account | `username, email, password` |
| `POST` | `/api/user/login` | Authenticate user | `email, password` |
| `POST` | `/api/user/forgotPassword` | Request password reset | `email` |
| `POST` | `/api/user/validate` | Verify reset token | `token` |
| `POST` | `/api/user/reset` | Set new password | `userId, password, token` |

### 📝 Post Management
| Method | Route | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/post` | Fetch latest 20 posts | No |
| `GET` | `/api/post/:id` | Get post details | No |
| `POST` | `/api/post` | Create a new post | Yes (JWT) |
| `PUT` | `/api/post` | Update existing post | Yes (Author Only) |
| `DELETE` | `/api/post/:id` | Remove a post | Yes (Author Only) |

### 💬 Comments
| Method | Route | Description | Body Parameters |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/post/:id/comment` | Add comment | `username, text` |
| `PUT` | `/api/post/:postId/comment/:commentId` | Edit comment | `text` |
| `DELETE` | `/api/post/:postId/comment/:commentId` | Delete comment | None |

### 🖼 Media & Utilities
| Method | Route | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/upload-signature` | Signed Cloudinary signature | Yes (JWT) |

## 📂 Project Structure

```text
.
├── controllers/      # Route controllers (User logic)
│   └── userController.js
├── models/           # Mongoose schemas (User, Post)
│   ├── Post.js
│   └── User.js
├── routes/           # User route definitions
│   └── user.js
├── uploads/          # Temporary local storage
├── server.js         # Entry point & Post routes
├── smtp.js           # Email configuration & Template
├── package.json      # Dependencies & scripts
└── .env              # Environment config (git-ignored)
```
