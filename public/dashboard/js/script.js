function setButtonLoading(buttonId, isLoading) {
    const button = document.getElementById(buttonId);
    const loadingIcon = button.querySelector("svg");
    const buttonText = button.querySelector("span");

    if (isLoading) {
        buttonText.setAttribute("data-original-text", buttonText.textContent);
        buttonText.textContent = "Loading...";
        loadingIcon.classList.remove("hidden");
        button.classList.add("opacity-50", "cursor-not-allowed");
        button.disabled = true;
    } else {
        buttonText.textContent = buttonText.getAttribute("data-original-text");
        loadingIcon.classList.add("hidden");
        button.classList.remove("opacity-50", "cursor-not-allowed");
        button.disabled = false;
    }
}


// Handles launching Linux instances
document.getElementById("launchLinuxButton").addEventListener("click", () => {
    setButtonLoading("launchLinuxButton", true);
    handleLaunch("linux");
});

// Handles launching Windows instances
document.getElementById("launchWindowsButton").addEventListener("click", () => {
    setButtonLoading("launchWindowsButton", true);
    handleLaunch("windows");
});



let currentInstanceId = "";

document.getElementById("logoutButton").addEventListener("click", async () => {
  setButtonLoading("logoutButton", true);
  await fetch("/logout", { method: "POST", credentials: "include" });
  window.location.href = "/login";
});

  
  document.getElementById("downloadSshKeyButton").addEventListener("click", () => {
    setButtonLoading("downloadSshKeyButton", true);
    downloadSshKey();
  });
  

async function downloadSshKey() {
  const response = await fetch("/api/ec2/get-linux-ssh-key");
  const downloadData = await response.json();

  const downloadUrl = downloadData.downloadUrl;
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = downloadData.filename || "ssh-key.pem";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setButtonLoading("downloadSshKeyButton", false);
}

async function handleLaunch(instanceType) {
  const response = await fetch("/api/ec2/launch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instanceType }),
  });
  const result = await response.json();
  fetchInstances();

  if (instanceType === "linux") {
    setButtonLoading("launchLinuxButton", false);
  } else if (instanceType === "windows") {
    setButtonLoading("launchWindowsButton", false);
  }
  new Noty({
    text: result.message,
    type: result.success ? "success" : "error",
    layout: "bottomRight",
    timeout: 5000,
    theme: "metroui",
    progressBar: true,
  }).show();
}

async function fetchInstances() {
  try {
    const response = await fetch("/api/ec2/instances");
    if (!response.ok) throw new Error("Failed to fetch instances");
    const instances = await response.json();
    const container = document.getElementById("instances");
    container.innerHTML = "";
      instances.forEach((instance) => {
        const instanceId = instance.InstanceId;
        const state = instance.State;
        const instanceName =
          instance.Tags.find((tag) => tag.Key === "Name")?.Value || "Unnamed";
        const publicIp = instance.PublicIpAddress || "N/A";
        const privateIp = instance.PrivateIpAddress || "N/A";
        const launchTime = new Date(instance.LaunchTime).toLocaleString();
        const owner =
          instance.Tags.find((tag) => tag.Key === "username")?.Value || "N/A";

        let actionButtons = "";
        if (state === "running") {
          actionButtons = `<button onclick="handleAction('${instanceId}', 'stop')" class="bg-red-600 text-gray-100 py-2 px-4 rounded hover:bg-red-700 mt-4">Stop</button>`;
        } else if (state === "stopped") {
          actionButtons = `<button onclick="handleAction('${instanceId}', 'start')" class="bg-green-600 text-gray-100 py-2 px-4 rounded hover:bg-green-700 mt-4">Start</button>`;
        }

        if (state !== "shutting-down") {
          actionButtons += `
        <button onclick="showTerminateModal('${instanceId}')" class="bg-red-800 text-gray-100 py-2 px-4 rounded hover:bg-red-900 mt-4">Terminate</button>
        `;
        }

        if (instanceName === "WINDOWS-INSTANCE") {
          actionButtons += `
          <button onclick="showPasswordModal('${instanceId}')" class="bg-white text-black py-2 px-4 rounded hover:bg-gray-200 mt-4">Show Password</button>
        `;
        }

        const instanceHtml = `
        <div class="bg-gray-800 shadow-lg rounded-lg p-6">
          <h2 class="text-xl font-semibold mb-2">Instance ID: ${instanceId}</h2>
          <p class="text-gray-300 mb-2">State: <span class="font-semibold ${
            state === "running" ? "text-green-400" : "text-red-400"
          }">${state}</span></p>
          <p class="text-gray-300 mb-2">Name: ${instanceName}</p>
          <p class="text-gray-300 mb-2">
            Username: ${
              instanceName === "LINUX-INSTANCE"
                ? "ubuntu"
                : instanceName === "WINDOWS-INSTANCE"
                ? "Administrator"
                : ""
            }
          </p>
          <p class="text-gray-300 mb-2">Public IP: ${publicIp}</p>
          <p class="text-gray-300 mb-2">Private IP: ${privateIp}</p>
          <p class="text-gray-300 mb-2">Launch Time: ${launchTime}</p>
          <p class="text-gray-300 mb-2">Instance owner: ${owner}</p>
          ${actionButtons}
        </div>
      `;
        container.innerHTML += instanceHtml;
      });
  } catch (error) {
    console.error("Error fetching instances:", error);
    new Noty({
      text: "Error fetching instances. Please try again later.",
      type: "error",
      layout: "bottomRight",
      timeout: 5000,
      theme: "metroui",
      progressBar: true,
    }).show();
  }
}


async function handleAction(instanceId, action) {
  const response = await fetch("/api/ec2/manage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instanceId, action }),
  });
  const result = await response.json();
  new Noty({
    text: result.message,
    type: result.success ? "success" : "error",
    layout: "bottomRight",
    timeout: 5000,
    theme: "metroui",
    progressBar: true,
  }).show();
}

function showTerminateModal(instanceId) {
  currentInstanceId = instanceId;
  document.getElementById("terminateModal").style.display = "flex";
}

function hideTerminateModal() {
  document.getElementById("modalInstanceId").value = "";
  document.getElementById("terminateModal").style.display = "none";
}

async function handleTerminate() {
    setButtonLoading("confirmTerminateButton", true);
    const inputInstanceId = document.getElementById("modalInstanceId").value;
    if (inputInstanceId !== currentInstanceId) {
      new Noty({
        text: "Instance ID does not match. Please type the correct instance ID to confirm termination.",
        type: "error",
        layout: "bottomRight",
        timeout: 5000,
        theme: "metroui",
        progressBar: true,
      }).show();
      setButtonLoading("confirmTerminateButton", false);
      return;
    }
  
    try {
      const response = await fetch("/api/ec2/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceId: currentInstanceId,
          action: "terminate",
          confirmText: inputInstanceId,
        }),
      });
      const result = await response.json();
      new Noty({
        text: result.message,
        type: result.success ? "success" : "error",
        layout: "bottomRight",
        timeout: 5000,
        theme: "metroui",
        progressBar: true,
      }).show();
      fetchInstances();
    } catch (error) {
      console.error("Error terminating instance:", error);
      new Noty({
        text: "Error terminating instance. Please try again later.",
        type: "error",
        layout: "bottomRight",
        timeout: 5000,
        theme: "metroui",
        progressBar: true,
      }).show();
    } finally {
      setButtonLoading("confirmTerminateButton", false);
      hideTerminateModal();
    }
  }
  

async function showPasswordModal(instanceId) {
  currentInstanceId = instanceId;
  const passwordInput = document.getElementById("passwordInput");
  const passwordInstanceId = document.getElementById("passwordInstanceId");
  passwordInstanceId.textContent = instanceId;
  passwordInput.value = "Decrypting password...";
  document.getElementById("passwordModal").style.display = "flex";

  try {
    const response = await fetch(`/api/ec2/get-windows-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId }),
    });
    const result = await response.json();
    if (result.password) {
      passwordInput.value = result.password;
    } else {
        hidePasswordModal();
        new Noty({
          text: "Password not yet available, wait a few minutes and try again.",
          type: "error",
          layout: "bottomRight",
          timeout: 5000,
          theme: "metroui",
          progressBar: true,
        }).show();
    }
  } catch (error) {
    console.error("Error fetching password:", error);
      hidePasswordModal();
      new Noty({
        text: "Password not yet available, wait a few minutes and try again.",
        type: "error",
        layout: "bottomRight",
        timeout: 5000,
        theme: "metroui",
        progressBar: true,
      }).show();
  }
}

document.getElementById("copyPasswordButton").addEventListener("click", () => {
  const passwordInput = document.getElementById("passwordInput");
  passwordInput.select();
  document.execCommand("copy");
  new Noty({
    text: "Password copied to clipboard!",
    type: "success",
    layout: "bottomRight",
    timeout: 3000,
    theme: "metroui",
    progressBar: true,
  }).show();
});

function hidePasswordModal() {
  document.getElementById("passwordModal").style.display = "none";
}

document.getElementById("confirmTerminateButton").addEventListener("click", handleTerminate);
document.getElementById("cancelTerminateButton").addEventListener("click", hideTerminateModal);
document.getElementById("closePasswordModalButton").addEventListener("click", hidePasswordModal);


fetchInstances();

setInterval(fetchInstances, 5000);

