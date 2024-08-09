import AWS from 'aws-sdk';
import express from 'express';
import serverless from 'serverless-http';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import url from 'url';

const app = express();
AWS.config.update({ region: 'eu-central-2' });
const ec2 = new AWS.EC2();

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const VPC_ID = process.env.VPC_ID;
const LINUX_LAUNCH_TEMPLATE_ID = process.env.LINUX_LAUNCH_TEMPLATE_ID;
const WINDOWS_LAUNCH_TEMPLATE_ID = process.env.WINDOWS_LAUNCH_TEMPLATE_ID;

const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID;
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET;
const OAUTH_AUTHORIZATION_URL = process.env.OAUTH_AUTHORIZATION_URL;
const OAUTH_TOKEN_URL = process.env.OAUTH_TOKEN_URL;
const OAUTH_USER_INFO_URL = process.env.OAUTH_USER_INFO_URL;
const OAUTH_REDIRECT_URL = process.env.OAUTH_REDIRECT_URL;

app.use(express.json());
app.use(cookieParser());

app.use('/', checkAuth, express.static(path.join(__dirname, 'public/dashboard')));

app.use('/login', express.static(path.join(__dirname, 'public/login')));


// Check token
async function checkAuth(req, res, next) {
  const access_token = req.cookies.access_token;
  if (!access_token) {
    return res.redirect('/login');
  }

  try {
    const checkUserAccess = await fetch(OAUTH_USER_INFO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${access_token}`,
      },
    });

    if (!checkUserAccess.ok) {
      return res.redirect('/login');
    }

    const userData = await checkUserAccess.json();
    const { username, roles } = userData;

    req.username = username;
    req.roles = roles;

    if (!roles.includes('standardUser')) {
      return res.status(403).json({ error: "You are not authorized to access this ressource" });
    }

    next(); 
  } catch (error) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
}


// Authenticate endpoint
app.get("/api/auth", async (req, res) => {
  if (req.cookies.refresh_token !== undefined) {
    try {
      const response = await fetch(OAUTH_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: req.cookies.refresh_token,
          client_secret: OAUTH_CLIENT_SECRET,
        }),
      });

      if (!response.ok) {
        res.clearCookie('access_token');
        res.clearCookie('refresh_token');
        return res.redirect('/login');
      }

      const data = await response.json();
      const { access_token, refresh_token } = data;

      res.cookie('access_token', access_token, { httpOnly: true, maxAge: 50 * 60 * 1000 });
      res.cookie('refresh_token', refresh_token, { httpOnly: true, maxAge: 20 * 24 * 60 * 60 * 1000 });

      return res.redirect("/");
    } catch (error) {
      return res.redirect('/login');
    }
  }
  return res.redirect(`${OAUTH_AUTHORIZATION_URL}?client_id=${OAUTH_CLIENT_ID}&redirect_uri=${OAUTH_REDIRECT_URL}`);
});


// Callback endpoint
app.get("/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.redirect("/api/auth");
  }

  try {
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        client_id: OAUTH_CLIENT_ID,
        client_secret: OAUTH_CLIENT_SECRET,
        redirect_uri: OAUTH_REDIRECT_URL,
      }),
    });

    if (!response.ok) {
      return res.status(403).redirect("/api/auth");
    }

    const responseData = await response.json();
    const { access_token, refresh_token } = responseData;

    res.cookie('access_token', access_token, { httpOnly: true, maxAge: 50 * 60 * 1000 });
    res.cookie('refresh_token', refresh_token, { httpOnly: true, maxAge: 20 * 24 * 60 * 60 * 1000 });

    res.redirect("/");

  } catch (error) {
    return res.redirect('/login'); 
  }
});

// Logout endpoint
app.post("/logout", async (req, res) => {
  res.clearCookie('access_token');
  res.clearCookie('refresh_token');
  res.status(200).json({ message: "Logged out successfully" });
});


const getInstancesInVPC = async (VPC_ID) => {
  const params = {
    Filters: [
      {
        Name: 'vpc-id',
        Values: [VPC_ID],
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


app.get('/api/ec2/instances', checkAuth, async (req, res) => {
  const username = req.username;
  try {
    const instances = await getInstancesInVPC(VPC_ID);

    const filteredInstances = instances.filter(instance => {
      const tags = instance.Tags || [];
      const usernameTag = tags.find(tag => tag.Key === 'username');
      return usernameTag && usernameTag.Value === username;
    });

    res.json(filteredInstances);
  } catch (error) {
    console.error('Error fetching instances:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});



async function countUserInstances(username) {
  const params = {
    Filters: [
      {
        Name: 'tag:username',
        Values: [username]
      },
      {
        Name: 'instance-state-name',
        Values: ['pending', 'running']
      }
    ]
  };

  const data = await ec2.describeInstances(params).promise();
  const instances = data.Reservations.flatMap(reservation => reservation.Instances);
  return instances.length;
}

async function launchInstance(req, res, launchTemplateId) {
  const username = req.username;

  try {
    const count = await countUserInstances(username);

    if (count >= 4) {
      return res.json({ success: false, message: 'You are permitted to launch only four instances at a time' });
    }

    const params = {
      LaunchTemplate: {
        LaunchTemplateId: launchTemplateId,
      },
      MinCount: 1,
      MaxCount: 1,
      TagSpecifications: [
        {
          ResourceType: 'instance',
          Tags: [
            {
              Key: 'username',
              Value: username
            },
          ]
        }
      ]
    };

    await ec2.runInstances(params).promise();
    res.json({ success: true, message: 'Instance launched successfully' });
  } catch (error) {
    console.error('Error launching instance:', error);
    res.json({ success: false, message: 'Error launching instance' });
  }
}

app.post('/api/ec2/launch', checkAuth, async (req, res) => {
  const instanceType = req.body.instanceType;

  if (instanceType === 'linux') {
    await launchInstance(req, res, LINUX_LAUNCH_TEMPLATE_ID);
  } else if (instanceType === 'windows') {
    await launchInstance(req, res, WINDOWS_LAUNCH_TEMPLATE_ID);
  } else {
    return res.json({ success: false, message: 'Invalid instance type' });
  }
});



app.post('/api/ec2/manage', checkAuth, async (req, res) => {
  const username = req.username;
  const { instanceId, action, confirmText } = req.body;
  const validActions = ['start', 'stop', 'terminate'];

  // Validate action
  if (!validActions.includes(action)) {
    return res.status(400).json({ message: 'Invalid action', type: 'error' });
  }

  try {
    // Describe the instance
    const instanceData = await ec2.describeInstances({ InstanceIds: [instanceId] }).promise();
    const tags = instanceData.Reservations[0].Instances[0].Tags;
    const usernameTag = tags.find(tag => tag.Key === 'username');

    // Check if the action is authorized
    if (!usernameTag || usernameTag.Value !== username) {
      return res.status(401).json({ message: 'Unauthorized action', type: 'error' });
    }

    // Perform the requested action
    if (action === 'start') {
      await ec2.startInstances({ InstanceIds: [instanceId] }).promise();
      return res.status(200).json({ message: 'Instance started successfully', type: 'success' });
    } else if (action === 'stop') {
      await ec2.stopInstances({ InstanceIds: [instanceId] }).promise();
      return res.status(200).json({ message: 'Instance stopped successfully', type: 'success' });
    } else if (action === 'terminate') {
      if (confirmText !== instanceId) {
        return res.status(400).json({ message: 'Invalid confirmation text', type: 'error' });
      }
      await ec2.terminateInstances({ InstanceIds: [instanceId] }).promise();
      return res.status(200).json({ message: 'Instance terminated successfully', type: 'success' });
    }
  } catch (error) {
    console.error('Error performing action:', error);
    return res.status(500).json({ message: 'Error performing action', type: 'error' });
  }
});


app.get('/download-ssh-key', checkAuth, (req, res) => {
  const keyFilePath = path.join(__dirname, 'instance_access', 'ssh.pem');

  // Check if file exists
  if (!fs.existsSync(keyFilePath)) {
    return res.status(404).send('SSH key file not found');
  }

  res.download(keyFilePath, 'ssh.pem', (err) => {
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


export const handler = serverless(app);
