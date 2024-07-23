const nodemailer = require('nodemailer');








const sendVerificationEmail = (user, token) => {

    const baseUrl = process.env.BASE_URL;
    const url = `${baseUrl}/verify-email?token=${token}`;

    const emailTemplate = `
    <html>
        <head>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    background-color: #f7f7f7;
                    margin: 0;
                    padding: 0;
                }
                .container {
                    width: 100%;
                    max-width: 600px;
                    margin: 0 auto;
                    background-color: #ffffff;
                    padding: 20px;
                    box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                }
                .header {
                    text-align: center;
                    padding-bottom: 20px;
                }
                .header img {
                    width: 100px;
                }
                .content {
                    text-align: center;
                }
                .content h1 {
                    color: #333333;
                }
                .content p {
                    color: #666666;
                }
                .content a {
                    display: inline-block;
                    padding: 10px 20px;
                    margin-top: 20px;
                    text-decoration: none;
                    background-color: #007bff;
                    color: #ffffff;
                    border-radius: 5px;
                }
                .footer {
                    text-align: center;
                    padding-top: 20px;
                    color: #aaaaaa;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <img src="https://wg.alkimiasoft.com/assets/AlkimiaSoft.png" alt="Alkimia Soft">
                </div>
                <div class="content">
                    <h1>Email Verification</h1>
                    <p>Hello ${user.username},</p>
                    <p>Thank you for signing up at our Waifu Generator! Please click the button below to verify your email address and activate your account:</p>
                    <a href="${url}">Verify Email</a>
                    <p>If you did not sign up for this account, please ignore this email.</p>
                </div>
                <div class="footer">
                    <p>© 2024 AlkimiaSoft, Inc. All rights reserved.</p>
                    <p>If you have any questions, feel free to <a href="mailto:support@alkimiasoft.com">contact our support team</a>.</p>
                </div>
            </div>
        </body>
    </html>
    `;

    const transporter = nodemailer.createTransport({
        port: 587,
        host: process.env.MAILER_HOST,
        auth: {
            user: process.env.MAILER_USER,
            pass: process.env.MAILER_PWD
        },
        secure: false, // upgrades later with STARTTLS -- change this based on the PORT
    });

    transporter.sendMail({
        from: 'miki@alkimiasoft.com',
        to: user.email,
        subject: 'Verify Email',
        html: emailTemplate //`Click <a href="${url}">here</a> to confirm your email.`
    });
};

module.exports = { sendVerificationEmail };
