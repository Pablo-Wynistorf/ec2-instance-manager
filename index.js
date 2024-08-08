import AWS from 'aws-sdk';
import express from 'express';
import serverless from 'serverless-http';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';
import url from 'url';

const app = express();
AWS.config.update({ region: 'eu-central-2' });
const ec2 = new AWS.EC2();

const vpcId = process.env.VPC_ID;
const PASSWORD = process.env.PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;
const LINUX_LAUNCH_TEMPLATE_ID = process.env.LINUX_LAUNCH_TEMPLATE_ID;
const WINDOWS_LAUNCH_TEMPLATE_ID = process.env.WINDOWS_LAUNCH_TEMPLATE_ID;

app.use(express.json());
app.use(cookieParser());

const getInstancesInVPC = async (vpcId) => {
  const params = {
    Filters: [
      {
        Name: 'vpc-id',
        Values: [vpcId],
      },
    ],
  };

  try {
    const data = await ec2.describeInstances(params).promise();
    return data.Reservations.flatMap(reservation => reservation.Instances);
  } catch (error) {
    console.error('Error retrieving instances:', error);
    throw new Error('Error retrieving instances');
  }
};

// Middleware to check for access token
const checkAuth = (req, res, next) => {
  const token = req.cookies.access_token;
  if (token) {
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        return res.status(403).send(loginHtml);
      }
      req.user = user;
      next();
    });
  } else {
    res.send(loginHtml);
  }
};

const loginHtml = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="bg-gray-900 flex justify-center items-center h-screen">
    <div class="bg-gray-800 text-gray-100 p-8 rounded-lg shadow-lg max-w-md w-full">
      <h2 class="text-3xl font-bold mb-6">Login</h2>
      <form id="loginForm">
        <input 
          type="password" 
          id="password" 
          placeholder="Enter password" 
          required 
          class="w-full p-3 mb-4 bg-gray-700 border border-gray-600 rounded-md text-gray-100"
        >
        <button 
          type="submit" 
          class="w-full p-3 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Login
        </button>
      </form>
    </div>
    <script>
      document.getElementById('loginForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const password = document.getElementById('password').value;
        const response = await fetch('/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        const result = await response.json();
        if (response.status === 200) {
          window.location.href = '/';
        } else {
          alert(result.message);
        }
      });
    </script>
  </body>
  </html>
`;

app.get('/', checkAuth, async (req, res) => {
  try {
    const instances = await getInstancesInVPC(vpcId);
    let html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Can's EC2 Instances</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/noty/3.1.4/noty.min.css" />
        <style>
          #noty-top-right { top: 16px; right: 16px; }
        </style>
      </head>
      <body class="bg-gray-900 text-gray-100 font-sans leading-normal tracking-normal">
        <div class="container mx-auto p-6">
          <div class="flex justify-between items-center mb-6">
            <button id="logoutButton" class="p-2 bg-red-600 text-white rounded-md hover:bg-red-700">
              Logout
            </button>
            <div class="flex space-x-2">
              <button id="downloadWindowsPasswordButton" class="p-2 bg-white text-gray-800 rounded-md hover:bg-gray-200">
                Download Windows Password
              </button>
              <button id="downloadSshKeyButton" class="p-2 bg-white text-gray-800 rounded-md hover:bg-gray-200">
                Download SSH Key
              </button>
              <button id="launchLinuxButton" class="p-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                Launch Linux
              </button>
              <button id="launchWindowsButton" class="p-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                Launch Windows
              </button>
            </div>
          </div>
          <h1 class="text-3xl font-bold mb-6">Can's EC2 Instances</h1>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
    `;

    instances.forEach(instance => {
      const instanceId = instance.InstanceId;
      const state = instance.State.Name;
      const instanceName = instance.Tags.find(tag => tag.Key === 'Name')?.Value || 'Unnamed';
      const publicIp = instance.PublicIpAddress || 'N/A';
      const privateIp = instance.PrivateIpAddress || 'N/A';

      let actionButtons = '';
      if (state === 'running') {
        actionButtons = `
          <form action="/${instanceId}/stop" method="get" class="mt-4">
            <button type="submit" class="bg-red-600 text-gray-100 py-2 px-4 rounded hover:bg-red-700">Stop</button>
          </form>
        `;
      } else if (state === 'stopped') {
        actionButtons = `
          <form action="/${instanceId}/start" method="get" class="mt-4">
            <button type="submit" class="bg-green-600 text-gray-100 py-2 px-4 rounded hover:bg-green-700">Start</button>
          </form>
        `;
      }

      actionButtons += `
        <form action="/${instanceId}/terminate" method="get" class="mt-4">
          <label for="confirm-text" class="block text-gray-300 mb-2">Type the <span class="font-semibold">instance id</span> to confirm termination:</label>
          <input type="text" id="confirm-text" name="confirmText" class="bg-gray-700 text-gray-100 p-2 rounded w-full mb-2" required>
          <button type="submit" class="bg-red-800 text-gray-100 py-2 px-4 rounded hover:bg-red-900">Terminate</button>
        </form>
      `;

      html += `
        <div class="bg-gray-800 shadow-lg rounded-lg p-6">
          <h2 class="text-xl font-semibold mb-2">Instance ID: ${instanceId}</h2>
          <p class="text-gray-300 mb-2">Name: ${instanceName}</p>
          <p class="text-gray-300 mb-2">State: <span class="font-semibold ${state === 'running' ? 'text-green-400' : 'text-red-400'}">${state}</span></p>
          <p class="text-gray-300 mb-2">Public IP: ${publicIp}</p>
          <p class="text-gray-300 mb-2">Private IP: ${privateIp}</p>
          ${actionButtons}
        </div>
      `;
    });

    html += `
          </div>
        </div>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/noty/3.1.4/noty.min.js"></script>
        <script>
          document.getElementById('logoutButton').addEventListener('click', async () => {
            await fetch('/logout', { method: 'POST', credentials: 'include' });
            window.location.href = '/';
          });
          
          document.getElementById('launchLinuxButton').addEventListener('click', async () => {
            const response = await fetch('/ec2/launch/linux', { method: 'POST' });
            const result = await response.json();
            new Noty({
              text: result.message,
              type: result.success ? 'success' : 'error',
              layout: 'topRight',
              timeout: 5000,
              theme: 'metroui',
              progressBar: true
            }).show();
            if (result.success) {
              window.location.href = '/';
            }
          });
          
          document.getElementById('launchWindowsButton').addEventListener('click', async () => {
            const response = await fetch('/ec2/launch/windows', { method: 'POST' });
            const result = await response.json();
            new Noty({
              text: result.message,
              type: result.success ? 'success' : 'error',
              layout: 'topRight',
              timeout: 5000,
              theme: 'metroui',
              progressBar: true
            }).show();
            if (result.success) {
              window.location.href = '/';
            }
          });
          
          document.getElementById('downloadSshKeyButton').addEventListener('click', () => {
            window.location.href = '/download-ssh-key';
          });
          
          document.getElementById('downloadWindowsPasswordButton').addEventListener('click', () => {
            window.location.href = '/download-windows-password';
          });
          
          // Check for alert parameters in the query string
          const params = new URLSearchParams(window.location.search);
          const alertMessage = params.get('alert');
          const alertType = params.get('type');
          if (alertMessage) {
            new Noty({
              text: decodeURIComponent(alertMessage),
              type: alertType === 'success' ? 'success' : 'error',
              layout: 'topRight',
              timeout: 5000,
              theme: 'metroui',
              progressBar: true
            }).show();

            // Remove the alert query string from the URL
            params.delete('alert');
            params.delete('type');
            window.history.replaceState({}, document.title, window.location.pathname + (params.toString() ? '?' + params.toString() : ''));
          }
        </script>
      </body>
      </html>
    `;
    res.send(html);
  } catch (error) {
    res.status(500).send('Error retrieving instances');
  }
});



app.post('/ec2/launch/linux', checkAuth, async (req, res) => {
  const params = {
    LaunchTemplate: {
      LaunchTemplateId: LINUX_LAUNCH_TEMPLATE_ID,
    },
    MinCount: 1,
    MaxCount: 1
  };

  try {
    await ec2.runInstances(params).promise();
    res.json({ success: true, message: 'Linux instance launched successfully' });
  } catch (error) {
    console.error('Error launching Linux instance:', error);
    res.json({ success: false, message: 'Error launching Linux instance' });
  }
});

app.post('/ec2/launch/windows', checkAuth, async (req, res) => {
  const params = {
    LaunchTemplate: {
      LaunchTemplateId: WINDOWS_LAUNCH_TEMPLATE_ID,
    },
    MinCount: 1,
    MaxCount: 1
  };

  try {
    await ec2.runInstances(params).promise();
    res.json({ success: true, message: 'Windows instance launched successfully' });
  } catch (error) {
    console.error('Error launching Windows instance:', error);
    res.json({ success: false, message: 'Error launching Windows instance' });
  }
});


app.get('/:instanceId/:action', checkAuth, async (req, res) => {
  const { instanceId, action } = req.params;
  const validActions = ['start', 'stop', 'terminate'];

  if (!validActions.includes(action)) {
    return res.redirect('/?alert=Invalid%20action&type=error');
  }

  try {
    if (action === 'start') {
      await ec2.startInstances({ InstanceIds: [instanceId] }).promise();
      res.redirect('/?alert=Instance%20started%20successfully&type=success');
    } else if (action === 'stop') {
      await ec2.stopInstances({ InstanceIds: [instanceId] }).promise();
      res.redirect('/?alert=Instance%20stopped%20successfully&type=success');
    } else if (action === 'terminate') {
      const { confirmText } = req.query;
      if (confirmText !== instanceId) {
        return res.redirect('/?alert=Invalid%20confirmation%20text&type=error');
      }
      await ec2.terminateInstances({ InstanceIds: [instanceId] }).promise();
      res.redirect('/?alert=Instance%20terminated%20successfully&type=success');
    }
  } catch (error) {
    console.error('Error performing action:', error);
    res.redirect('/?alert=Error%20performing%20action&type=error');
  }
});

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

app.get('/download-ssh-key', checkAuth, (req, res) => {
  const keyFilePath = path.join(__dirname, 'instance_access', 'ssh-can.pem');

  // Check if file exists
  if (!fs.existsSync(keyFilePath)) {
    return res.status(404).send('SSH key file not found');
  }

  res.download(keyFilePath, 'ssh-can.pem', (err) => {
    if (err) {
      console.error('Error downloading SSH key:', err);
      res.status(500).send('Error downloading SSH key');
    }
  });
});

app.get('/download-windows-password', checkAuth, (req, res) => {
  const keyFilePath = path.join(__dirname, 'instance_access', 'windows-password.txt');

  // Check if file exists
  if (!fs.existsSync(keyFilePath)) {
    return res.status(404).send('Windows Password file not found');
  }

  res.download(keyFilePath, 'windows-password.txt', (err) => {
    if (err) {
      console.error('Error downloading windows password:', err);
      res.status(500).send('Error downloading windows password');
    }
  });
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === PASSWORD) {
    const token = jwt.sign({ user: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
    res.cookie('access_token', token, { httpOnly: true });
    res.status(200).json({ message: 'Login successful' });
  } else {
    res.status(401).json({ message: 'Invalid password' });
  }
});

app.post('/logout', (req, res) => {
  res.cookie('access_token', '', { httpOnly: true, expires: new Date(0) });
  res.status(200).json({ message: 'Logged out successfully' });
});

export const handler = serverless(app);
