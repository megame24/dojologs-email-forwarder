const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { SSMClient, GetParametersCommand } = require("@aws-sdk/client-ssm");
const nodemailer = require('nodemailer');
const simpleParser = require('mailparser').simpleParser;

const s3Client = new S3Client({ region: process.env.AWS_REGION });

const ssmClient = new SSMClient({ region: process.env.AWS_REGION });


const getAndSetSecretes = async () => {
  const params = {
    Names: [
      process.env.GMAIL_ADDRESS_NAME,
      process.env.GMAIL_PASSWORD_NAME,
    ],
    WithDecryption: true
  }

  const command = new GetParametersCommand(params);
  const data = await ssmClient.send(command);

  data.Parameters.forEach(param => {
    process.env[param.Name] = param.Value;
  });
}


exports.handler = async (event) => {
  try {
    await getAndSetSecretes();

    // Gmail SMTP configuration
    const smtpConfig = {
      host: 'smtp.gmail.com',
      port: 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.GMAIL_ADDRESS,
        pass: process.env.GMAIL_PASSWORD
      }
    };
    
    // Nodemailer transporter
    const transporter = nodemailer.createTransport(smtpConfig);

    
    for (const record of event.Records) {
      const bucket = record.s3.bucket.name;
      const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

      // Get the email from S3
      const params = {
        Bucket: bucket,
        Key: key
      };
      const command = new GetObjectCommand(params);
      const data = await s3Client.send(command);

      // Parse the email
      const emailBody = await streamToString(data.Body);
      const parsedEmail = await simpleParser(emailBody);
      
      // Extract attachments
      const attachments = parsedEmail.attachments.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        contentType: attachment.contentType
      }));
      

      // Prepare the email
      const mailOptions = {
        from: process.env.GMAIL_ADDRESS,
        to: process.env.GMAIL_ADDRESS,
        subject: `Fwd: ${parsedEmail.subject}`,
        text: `Original sender: ${parsedEmail.from.text}\n\nOriginal receiver: ${parsedEmail.to.text}\n\n${parsedEmail.text}`,
        attachments
      };

      // Send the email
      await transporter.sendMail(mailOptions);
      console.log(`Email forwarded: ${key}`);
    }
  } catch (error) {
    console.error('Error forwarding email:', error);
  }
};

// Helper function to convert stream to string
const streamToString = (stream) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    stream.on('error', reject);
  });
};
