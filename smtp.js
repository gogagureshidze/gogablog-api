const nodemailer = require("nodemailer");

const htmlTemplate = (resetLink) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Reset Your Password - GogaBlog</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      background-color: #f2f4f8;
      color: #2c3e50;
    }

    .container {
      max-width: 600px;
      margin: 40px auto;
      background-color: #ffffff;
      border-radius: 12px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
      padding: 40px 30px;
      box-sizing: border-box;
    }

    h1 {
      color: #14274E;
      font-size: 28px;
      margin-bottom: 20px;
    }

    p {
      font-size: 16px;
      line-height: 1.6;
      margin-bottom: 24px;
    }

    a.button {
      display: inline-block;
      padding: 14px 28px;
      font-size: 16px;
      font-weight: bold;
      background-color: #FACC15;
      color: #14274E;
      text-decoration: none;
      border-radius: 8px;
      transition: all 0.3s ease;
    }

    a.button:hover {
      background-color: #eab308;
      transform: translateY(-2px);
    }

    .footer {
      font-size: 14px;
      color: #7f8c8d;
      margin-top: 40px;
      text-align: center;
    }

    @media (max-width: 600px) {
      .container {
        padding: 30px 20px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Password Reset Request</h1>
    <p>Hello,</p>
    <p>We received a request to reset your GogaBlog account password. Click the button below to proceed:</p>
    <p style="text-align:center;">
      <a class="button" href="${resetLink}" target="_blank" rel="noopener noreferrer">Reset Password</a>
    </p>
    <p>This link will expire in 15 minutes. If you didn’t request this, feel free to ignore this message—your account is safe.</p>
    <div class="footer">
      — The GogaBlog Team
    </div>
  </div>
</body>
</html>
`;

async function mail(user, resetLink) {
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    const htmlContent = htmlTemplate(resetLink);

    const info = await transporter.sendMail({
      from: `"GogaBlog" <${process.env.EMAIL}>`,
      to: user.email,
      subject: "Reset Your GogaBlog Password",
      html: htmlContent,
    });

    console.log("Email sent: %s", info.messageId);
  } catch (error) {
    console.error("Error sending reset email:", error);
  }
}

module.exports = { mail };
