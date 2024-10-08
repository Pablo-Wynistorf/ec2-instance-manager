import express from 'express';
import { 
  EC2Client, 
  RunInstancesCommand, 
  StartInstancesCommand, 
  StopInstancesCommand, 
  TerminateInstancesCommand, 
  GetPasswordDataCommand, 
  DescribeInstancesCommand, 
  DescribeKeyPairsCommand, 
  CreateKeyPairCommand, 
  CreateTagsCommand,
  DescribeSecurityGroupsCommand,
  CreateSecurityGroupCommand,
  AuthorizeSecurityGroupIngressCommand,
  ModifyInstanceAttributeCommand
} from '@aws-sdk/client-ec2';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import serverless from 'serverless-http';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs/promises';
import url from 'url';
import forge from 'node-forge';


const ec2Client = new EC2Client({ region: 'eu-central-2' });
const s3Client = new S3Client({ region: 'eu-central-1' });
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const app = express();

const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;
const VPC_ID = process.env.VPC_ID;
const LINUX_LAUNCH_TEMPLATE_ID = process.env.LINUX_LAUNCH_TEMPLATE_ID;
const WINDOWS_LAUNCH_TEMPLATE_ID = process.env.WINDOWS_LAUNCH_TEMPLATE_ID;

const SSH_SESSION_SERVER_URL = process.env.SSH_SESSION_SERVER_URL;

const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID;
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET;
const OAUTH_AUTHORIZATION_URL = process.env.OAUTH_AUTHORIZATION_URL;
const OAUTH_TOKEN_URL = process.env.OAUTH_TOKEN_URL;
const OAUTH_USER_INFO_URL = process.env.OAUTH_USER_INFO_URL;
const OAUTH_REDIRECT_URL = process.env.OAUTH_REDIRECT_URL;

app.use(express.json());
app.use(cookieParser());

app.get('/', (req, res) => {
  res.redirect('/login');
});

app.use('/dashboard', checkAuth, express.static(path.join(__dirname, 'public/dashboard')));
app.use('/login', redirectWithAccessToken, express.static(path.join(__dirname, 'public/login')));

async function redirectWithAccessToken(req, res, next) {
  const access_token = req.cookies.access_token;
  const refresh_token = req.cookies.refresh_token;
  if (!access_token && !refresh_token) {
    return next();
  }
  res.redirect('/dashboard');
}

// Check token and roles
async function checkAuth(req, res, next) {
  const access_token = req.cookies.access_token;
  if (!access_token) {
    return res.redirect('/api/auth');
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
      return res.redirect('/api/auth');
    }

    const userData = await checkUserAccess.json();
    const { username, roles } = userData;

    req.username = username;
    req.roles = roles;

    if (!roles.includes('standardUser') && !roles.includes('adminUser')) {
      return res.redirect('/denied');
    }

    next();
  } catch (error) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

app.use('/denied', (req, res, next) => {
  const access_token = req.cookies.access_token;

  if (!access_token) {
    return res.redirect('/login');
  }

  fetch(OAUTH_USER_INFO_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${access_token}`,
    },
  })
    .then(response => {
      if (!response.ok) {
        return next();
      }
      return response.json();
    })
    .then(userData => {
      const { roles } = userData;

      if (roles.includes('standardUser') || roles.includes('adminUser')) {
        return res.redirect('/dashboard');
      }

      res.sendFile(path.join(__dirname, 'public/denied/index.html'));
    })
    .catch(error => {
      console.error('Error during access check:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    });
});

// Authenticate endpoint
app.get('/api/auth', async (req, res) => {
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
      const { access_token } = data;

      res.cookie('access_token', access_token, { httpOnly: true, maxAge: 50 * 60 * 1000 });

      return res.redirect('/dashboard');
    } catch (error) {
      return res.redirect('/login');
    }
  }
  return res.redirect(`${OAUTH_AUTHORIZATION_URL}?client_id=${OAUTH_CLIENT_ID}&redirect_uri=${OAUTH_REDIRECT_URL}`);
});

// Callback endpoint
app.get('/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.redirect("/api/auth");
  }

  try {
    const tokenResponse = await fetch(process.env.OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        client_id: process.env.OAUTH_CLIENT_ID,
        client_secret: process.env.OAUTH_CLIENT_SECRET,
        redirect_uri: process.env.OAUTH_REDIRECT_URL,
      }),
    });

    if (!tokenResponse.ok) {
      return res.status(403).redirect("/api/auth");
    }

    const { access_token, refresh_token } = await tokenResponse.json();

    // Fetch user data using the obtained access_token
    const userDataResponse = await fetch(process.env.OAUTH_USER_INFO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${access_token}`,
      },
    });

    if (!userDataResponse.ok) {
      return res.status(403).redirect("/api/auth");
    }

    const { username, roles } = await userDataResponse.json();
    const sshKeyName = `${username}-ssh-key`;

    res.cookie('access_token', access_token, { httpOnly: true, maxAge: 50 * 60 * 1000 });
    res.cookie('refresh_token', refresh_token, { httpOnly: true, maxAge: 20 * 24 * 60 * 60 * 1000 });

    try {
      const securityGroupId = await ensureSecurityGroupExists(username, VPC_ID);
      console.log(`Security group ID: ${securityGroupId}`);
      const { KeyPairs } = await ec2Client.send(new DescribeKeyPairsCommand({ KeyNames: [sshKeyName] }));
      
      if (KeyPairs.length > 0) {
        if (roles.includes('standardUser')) {
        return res.redirect('/dashboard');
        }
        else {
          return res.redirect('/denied');
      }
    }
    } catch (err) {
      if (err.name !== 'InvalidKeyPair.NotFound') {
        console.error('Error checking SSH key:', err);
        return res.status(500).json({ error: "Internal Server Error" });
      }
    }

    try {
      const { KeyMaterial } = await ec2Client.send(new CreateKeyPairCommand({ KeyName: sshKeyName }));
      const keyFilePath = path.join('/tmp', `${sshKeyName}.pem`); 

      await Promise.all([
        fs.writeFile(keyFilePath, KeyMaterial),
        s3Client.send(new PutObjectCommand({
          Bucket: S3_BUCKET_NAME,
          Key: `${sshKeyName}.pem`,
          Body: Buffer.from(KeyMaterial),
          ContentType: 'application/x-pem-file',
        })),
      ]);

      await fs.unlink(keyFilePath);
      if (roles.includes('standardUser')) {
        return res.redirect('/dashboard');
      }
      else {
        return res.redirect('/denied');
      }
    } catch (err) {
      console.error('Error creating or uploading SSH key:', err);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  } catch (error) {
    console.error('Error in callback processing:', error);
    return res.redirect('/login');
  }
});


// Logout endpoint
app.post("/logout", async (req, res) => {
  res.clearCookie('access_token');
  res.clearCookie('refresh_token');
  res.status(200).json({ message: "Logged out successfully" });
});

// Helper function to get instances in a VPC
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
    const command = new DescribeInstancesCommand(params);
    const data = await ec2Client.send(command);
    return data.Reservations.flatMap(reservation => reservation.Instances);
  } catch (error) {
    console.error('Error retrieving instances:', error);
    throw new Error('Error retrieving instances');
  }
};

// Count user instances
const countUserInstances = async (username) => {
  const params = {
    Filters: [
      {
        Name: 'tag:username',
        Values: [username],
      },
    ],
  };

  try {
    const command = new DescribeInstancesCommand(params);
    const data = await ec2Client.send(command);
    const instances = data.Reservations.flatMap(reservation => 
      reservation.Instances.filter(instance => instance.State.Name !== 'terminated')
    );
    return instances.length;
  } catch (error) {
    console.error('Error counting user instances:', error);
    throw new Error('Error counting user instances');
  }
};

async function ensureSecurityGroupExists(username, vpcId) {
  const sgName = `${username}-sg`;
  
  try {
    const describeParams = {
      Filters: [
        {
          Name: 'group-name',
          Values: [sgName],
        },
        {
          Name: 'vpc-id',
          Values: [vpcId],
        },
      ],
    };

    const describeCommand = new DescribeSecurityGroupsCommand(describeParams);
    const describeResponse = await ec2Client.send(describeCommand);

    if (describeResponse.SecurityGroups.length > 0) {
      return describeResponse.SecurityGroups[0].GroupId;
    }

    const createParams = {
      GroupName: sgName,
      Description: `Security group for ${username}`,
      VpcId: vpcId,
    };

    const createCommand = new CreateSecurityGroupCommand(createParams);
    const createResponse = await ec2Client.send(createCommand);
    const securityGroupId = createResponse.GroupId;

    const ingressParams = {
      GroupId: securityGroupId,
      IpPermissions: [
        {
          IpProtocol: '-1',
          FromPort: -1,
          ToPort: -1,
          UserIdGroupPairs: [
            {
              GroupId: securityGroupId,
            },
          ],
        },
      ],
    };
    

    const authorizeCommand = new AuthorizeSecurityGroupIngressCommand(ingressParams);
    await ec2Client.send(authorizeCommand);

    return securityGroupId;
  } catch (error) {
    return console.error(`Error ensuring security group exists: ${error.message}`);
  }
}

// Attach security group to instance
const attachSecurityGroupToInstance = async (instanceId, securityGroupId, attachedSecurityGroupIds) => {
  try {
    const updatedSecurityGroupIds = [...attachedSecurityGroupIds, securityGroupId];

    const params = {
      InstanceId: instanceId,
      Groups: updatedSecurityGroupIds,
    };
    const command = new ModifyInstanceAttributeCommand(params);
    await ec2Client.send(command);

    console.log(`Security group ${securityGroupId} attached to instance ${instanceId} successfully.`);
  } catch (error) {
    console.error(`Failed to attach security group to instance ${instanceId}:`, error);
  }
};


// Launch EC2 instance
const launchLinuxInstance = async (req, res, launchTemplateId, securityGroupId) => {
  const username = req.username;
  const roles = req.roles;
  const sshKeyName = `${username}-ssh-key`;

  try {
    if (roles.includes('adminUser')) {
      const params = {
        LaunchTemplate: {
          LaunchTemplateId: launchTemplateId,
        },
        MinCount: 1,
        MaxCount: 1,
        KeyName: sshKeyName,
        TagSpecifications: [
          {
            ResourceType: 'instance',
            Tags: [
              {
                Key: 'username',
                Value: username,
              },
              {
                Key: 'operatingSystem',
                Value: 'linux',
              }
            ],
          },
        ],
      };

      const command = new RunInstancesCommand(params);
      const instanceData = await ec2Client.send(command);
      const instanceId = instanceData.Instances[0].InstanceId;
      const attachedSecurityGroupIds = instanceData.Instances[0].SecurityGroups.map(group => group.GroupId);

      await attachSecurityGroupToInstance(instanceId, securityGroupId, attachedSecurityGroupIds);

      return res.json({ success: true, message: 'Instance launched successfully' });
    }

    const currentInstanceCount = await countUserInstances(username);
    let maxAllowedInstances = 0;
    
    roles.forEach(role => {
      const match = role.match(/instanceCount-(\d+)/);
      if (match) {
        const instanceLimit = parseInt(match[1], 10);
        if (instanceLimit > maxAllowedInstances) {
          maxAllowedInstances = instanceLimit;
        }
      }
    });

    if (currentInstanceCount >= maxAllowedInstances) {
      return res.json({ 
        success: false, 
        message: `You are permitted to launch only ${maxAllowedInstances} instances in your account` 
      });
    }

    const params = {
      LaunchTemplate: {
        LaunchTemplateId: launchTemplateId,
      },
      MinCount: 1,
      MaxCount: 1,
      KeyName: sshKeyName,
      TagSpecifications: [
        {
          ResourceType: 'instance',
          Tags: [
            {
              Key: 'username',
              Value: username,
            },
            {
              Key: 'operatingSystem',
              Value: 'linux',
            }
          ],
        },
      ],
    };

    const command = new RunInstancesCommand(params);
    const instanceData = await ec2Client.send(command);
    const instanceId = instanceData.Instances[0].InstanceId;
    const attachedSecurityGroupIds = instanceData.Instances[0].SecurityGroups.map(group => group.GroupId);

    await attachSecurityGroupToInstance(instanceId, securityGroupId, attachedSecurityGroupIds);

    res.json({ success: true, message: 'Instance launched successfully' });
  } catch (error) {
    console.error('Error launching instance:', error);
    res.json({ success: false, message: 'Error launching instance' });
  }
};


const launchWindowsInstance = async (req, res, launchTemplateId, securityGroupId) => {
  const username = req.username;
  const roles = req.roles;

  try {
    if (roles.includes('adminUser')) {
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
                Value: username,
              },
              {
                Key: 'operatingSystem',
                Value: 'windows',
              }
            ],
          },
        ],
      };

      const command = new RunInstancesCommand(params);
      const instanceData = await ec2Client.send(command);
      const instanceId = instanceData.Instances[0].InstanceId;
      const attachedSecurityGroupIds = instanceData.Instances[0].SecurityGroups.map(group => group.GroupId);

      await attachSecurityGroupToInstance(instanceId, securityGroupId, attachedSecurityGroupIds);

      return res.json({ success: true, message: 'Instance launched successfully' });
    }

    const currentInstanceCount = await countUserInstances(username);
    let maxAllowedInstances = 0;
    
    roles.forEach(role => {
      const match = role.match(/instanceCount-(\d+)/);
      if (match) {
        const instanceLimit = parseInt(match[1], 10);
        if (instanceLimit > maxAllowedInstances) {
          maxAllowedInstances = instanceLimit;
        }
      }
    });

    if (currentInstanceCount >= maxAllowedInstances) {
      return res.json({ 
        success: false, 
        message: `You are permitted to launch only ${maxAllowedInstances} instances in your account` 
      });
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
              Value: username,
            },
            {
              Key: 'operatingSystem',
              Value: 'windows',
            }
          ],
        },
      ],
    };

    const command = new RunInstancesCommand(params);
    const instanceData = await ec2Client.send(command);
    const instanceId = instanceData.Instances[0].InstanceId;
    const attachedSecurityGroupIds = instanceData.Instances[0].SecurityGroups.map(group => group.GroupId);

    await attachSecurityGroupToInstance(instanceId, securityGroupId, attachedSecurityGroupIds);

    res.json({ success: true, message: 'Instance launched successfully' });
  } catch (error) {
    console.error('Error launching instance:', error);
    res.json({ success: false, message: 'Error launching instance' });
  }
};





async function getWindowsPassword(instanceId) {
  try {
    const privateKeyPath = path.resolve(__dirname, './instance_access/ec2-instance-manager-windows-password-key.pem');
    const privateKeyPem = await fs.readFile(privateKeyPath, 'utf8');

    const command = new GetPasswordDataCommand({ InstanceId: instanceId });
    const response = await ec2Client.send(command);

    if (!response.PasswordData) {
      throw new Error('No password data returned from AWS.');
    }

    const encryptedPassword = Buffer.from(response.PasswordData, 'base64');
    const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);

    const decryptedPassword = privateKey.decrypt(encryptedPassword.toString('binary'), 'RSAES-PKCS1-V1_5');

    return decryptedPassword;

  } catch (error) {
    throw new Error('Unable to retrieve or decrypt the Windows password.');
  }
}

// Get EC2 instance data
app.get('/api/ec2/instances', checkAuth, async (req, res) => {
  const username = req.username;
  const roles = req.roles;

  try {
    if (!username) {
      return res.status(400).json({ success: false, message: 'Username not provided' });
    }

    const instances = await getInstancesInVPC(VPC_ID);

    // Filter instances based on roles
    const filteredInstances = roles.includes('adminUser')
      ? instances
      : instances.filter(instance => {
          const tags = instance.Tags || [];
          const usernameTag = tags.find(tag => tag.Key === 'username');
          return usernameTag && usernameTag.Value === username;
        });

    // Format response to include only necessary fields
    const formattedInstances = filteredInstances.map(instance => ({
      InstanceId: instance.InstanceId,
      State: instance.State.Name,
      Tags: instance.Tags || [],
      PublicIpAddress: instance.PublicIpAddress || 'N/A',
      PrivateIpAddress: instance.PrivateIpAddress || 'N/A',
      LaunchTime: instance.LaunchTime ? new Date(instance.LaunchTime).toISOString() : null
    }));

    res.json(formattedInstances);
  } catch (error) {
    console.error('Error fetching instances:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});



// Launch EC2 instance
app.post('/api/ec2/launch', checkAuth, async (req, res) => {
  const instanceType = req.body.instanceType;
  const username = req.username;
  const securityGroupName = `${username}-sg`;

  try {
    const securityGroupParams = {
      Filters: [
        {
          Name: 'group-name',
          Values: [securityGroupName],
        },
      ],
    };

    const describeSGCommand = new DescribeSecurityGroupsCommand(securityGroupParams);
    const securityGroupData = await ec2Client.send(describeSGCommand);

    if (securityGroupData.SecurityGroups.length === 0) {
      return res.json({ success: false, message: 'Security Group not found, please contact a Administrator' });
    }

    const securityGroupId = securityGroupData.SecurityGroups[0].GroupId;

    if (instanceType === 'linux') {
      await launchLinuxInstance(req, res, LINUX_LAUNCH_TEMPLATE_ID, securityGroupId);
    } else if (instanceType === 'windows') {
      await launchWindowsInstance(req, res, WINDOWS_LAUNCH_TEMPLATE_ID, securityGroupId);
    } else {
      return res.json({ success: false, message: 'Invalid instance type' });
    }
  } catch (error) {
    console.error('Error launching instance or fetching Security Group:', error);
    return res.json({ success: false, message: 'Error launching instance or fetching Security Group' });
  }
});


// Manage EC2 instance
app.post('/api/ec2/manage', checkAuth, async (req, res) => {
  const username = req.username;
  const roles = req.roles;
  const { instanceId, action, confirmText, newName } = req.body;
  const validActions = ['start', 'stop', 'terminate', 'rename'];

  if (!validActions.includes(action)) {
    return res.status(400).json({ success: false, message: 'Invalid action' });
  }

  try {
    let instanceData;
    if (!roles.includes('adminUser')) {
      const describeCommand = new DescribeInstancesCommand({ InstanceIds: [instanceId] });
      instanceData = await ec2Client.send(describeCommand);
      const tags = instanceData.Reservations[0].Instances[0].Tags;
      const usernameTag = tags.find(tag => tag.Key === 'username');

      if (!usernameTag || usernameTag.Value !== username) {
        return res.status(401).json({ success: false, message: 'Unauthorized action' });
      }
    }

    if (action === 'start') {
      const actionCommand = new StartInstancesCommand({ InstanceIds: [instanceId] });
      await ec2Client.send(actionCommand);
      return res.status(200).json({ success: true, message: `Instance started successfully` });
    } else if (action === 'stop') {
      const actionCommand = new StopInstancesCommand({ InstanceIds: [instanceId] });
      await ec2Client.send(actionCommand);
      return res.status(200).json({ success: true, message: `Instance stopped successfully` });
    } else if (action === 'terminate') {
      if (confirmText !== instanceId) {
        return res.status(400).json({ success: false, message: 'Invalid confirmation text' });
      }
      const actionCommand = new TerminateInstancesCommand({ InstanceIds: [instanceId] });
      await ec2Client.send(actionCommand);
      return res.status(200).json({ success: true, message: `Instance terminated successfully` });
    } else if (action === 'rename') {
      if (!newName || typeof newName !== 'string') {
        return res.status(400).json({ success: false, message: 'Invalid new name provided' });
      }

      const tagCommand = new CreateTagsCommand({
        Resources: [instanceId],
        Tags: [{ Key: 'Name', Value: newName }],
      });
      await ec2Client.send(tagCommand);

      return res.status(200).json({ success: true, message: `Instance renamed to ${newName} successfully` });
    }
  } catch (error) {
    console.error('Error performing action:', error);
    return res.status(500).json({ success: false, message: 'Error performing action' });
  }
});

// Get Windows password
app.post('/api/ec2/get-windows-password', checkAuth, async (req, res) => {
  const username = req.username;
  const roles = req.roles;
  const { instanceId } = req.body;

  if (!instanceId) {
    return res.status(400).json({ message: 'Instance ID not provided' });
  }

  try {
    let instanceData;
    if (!roles.includes('adminUser')) {
      const describeCommand = new DescribeInstancesCommand({ InstanceIds: [instanceId] });
      instanceData = await ec2Client.send(describeCommand);
      const tags = instanceData.Reservations[0].Instances[0].Tags;
      const usernameTag = tags.find(tag => tag.Key === 'username');

      if (!usernameTag || usernameTag.Value !== username) {
        return res.status(401).json({ message: 'Unauthorized action', type: 'error' });
      }
    }

    const password = await getWindowsPassword(instanceId);

    if (!password) {
      return res.status(404).json({ message: 'Password not available' });
    }

    res.json({ password });
  } catch (error) {
    console.error('Password is not yet available, it can take up to 5 minutes', error);
    res.status(500).json({ message: 'Password is not yet available, it can take up to 5 minutes' });
  }
});


// Download SSH key
app.get('/api/ec2/get-linux-ssh-key', checkAuth, async (req, res) => {
  const username = req.username;
  const sshKeyName = `${username}-ssh-key.pem`;

  try {
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: sshKeyName,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 10 });

    res.json({ downloadUrl: url });
  } catch (error) {
    console.error('Error generating S3 pre-signed URL:', error);
    res.status(500).json({ error: 'Error generating download link' });
  }
});

app.get('/api/ec2/ssh', checkAuth, async (req, res) => {
  const { instanceId } = req.query;
  const username = req.username;
  const roles = req.roles;

  if (!instanceId) {
    return res.status(400).json({ message: 'Instance ID not provided' });
  }

  try {
    let instanceData;
    let instanceIp;
    let usernameTag;

    if (!roles.includes('adminUser')) {
      const describeCommand = new DescribeInstancesCommand({ InstanceIds: [instanceId] });
      instanceData = await ec2Client.send(describeCommand);
      const instance = instanceData.Reservations[0].Instances[0];
      const tags = instance.Tags;
      instanceIp = instance.PublicIpAddress;
      usernameTag = tags.find(tag => tag.Key === 'username');

      if (!usernameTag || usernameTag.Value !== username) {
        return res.status(401).json({ message: 'Unauthorized action', type: 'error' });
      }
    } else {
      const describeCommand = new DescribeInstancesCommand({ InstanceIds: [instanceId] });
      instanceData = await ec2Client.send(describeCommand);
      instanceIp = instanceData.Reservations[0].Instances[0].PublicIpAddress;
      usernameTag = instanceData.Reservations[0].Instances[0].Tags.find(tag => tag.Key === 'username');
    }

    if (!instanceIp) {
      return res.status(404).json({ message: 'Instance IP not available' });
    }

    const sshKeyName = `${usernameTag.Value}-ssh-key.pem`;
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: sshKeyName,
    });

    try {
      const url = await getSignedUrl(s3Client, command, { expiresIn: 10 });
      const base64_encoded_url = Buffer.from(url).toString('base64');
      const sshSessionUrl = `${SSH_SESSION_SERVER_URL}/connect?hostname=${instanceIp}&username=ubuntu&privateKeyUrl=${base64_encoded_url}`;

      res.redirect(sshSessionUrl);
    } catch (error) {
      console.error('Error generating S3 pre-signed URL:', error);
      return res.status(500).json({ error: 'Error generating SSH key URL' });
    }

  } catch (error) {
    console.error('Error describing EC2 instance:', error);
    return res.status(500).json({ error: 'Error retrieving EC2 instance data' });
  }
});

export const handler = serverless(app);

