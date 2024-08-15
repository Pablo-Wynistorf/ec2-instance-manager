function setButtonLoading(buttonId, isLoading) {
    const button = document.getElementById(buttonId);
    
    if (!button) {
        console.error(`Button with ID ${buttonId} not found.`);
        return;
    }

    const loadingIcon = button.querySelector("svg");
    const buttonText = button.querySelector("span");

    if (!buttonText) {
        console.error(`Button text element (span) not found inside button with ID ${buttonId}.`);
        return;
    }

    // Create a container for both the text and the loading icon
    let textAndIconContainer = button.querySelector(".text-and-icon");
    if (!textAndIconContainer) {
        textAndIconContainer = document.createElement("div");
        textAndIconContainer.classList.add("text-and-icon", "flex", "items-center", "space-x-2");
        buttonText.parentNode.insertBefore(textAndIconContainer, buttonText);
        textAndIconContainer.appendChild(buttonText);
        if (loadingIcon) textAndIconContainer.appendChild(loadingIcon);
    }

    if (isLoading) {
        buttonText.setAttribute("data-original-text", buttonText.textContent);
        buttonText.textContent = "Loading...";
        if (loadingIcon) loadingIcon.classList.remove("hidden");
        button.classList.add("opacity-50", "cursor-not-allowed");
        button.disabled = true;
    } else {
        buttonText.textContent = buttonText.getAttribute("data-original-text");
        if (loadingIcon) loadingIcon.classList.add("hidden");
        button.classList.remove("opacity-50", "cursor-not-allowed");
        button.disabled = false;
    }
}




document.getElementById("launchLinuxButton").addEventListener("click", () => {
    setButtonLoading("launchLinuxButton", true);
    handleLaunch("linux");
});

document.getElementById("launchWindowsButton").addEventListener("click", () => {
    setButtonLoading("launchWindowsButton", true);
    handleLaunch("windows");
});

document.getElementById("logoutButton").addEventListener("click", async () => {
    setButtonLoading("logoutButton", true);
    await fetch("/logout", { method: "POST", credentials: "include" });
    window.location.href = "/login";
});

document.getElementById("downloadSshKeyButton").addEventListener("click", () => {
    setButtonLoading("downloadSshKeyButton", true);
    downloadSshKey();
});

document.getElementById("cancelEditButton").addEventListener("click", async () => {
    hideEditInstanceNameModal();
});

document.getElementById("confirmEditButton").addEventListener("click", async () => {
    const newName = document.getElementById("newInstanceName").value;
    if (!newName) {
        new Noty({
            text: "Instance name cannot be empty.",
            type: "error",
            layout: "bottomRight",
            timeout: 5000,
            theme: "metroui",
            progressBar: true,
        }).show();
        return;
    }
    handleAction(currentInstanceId, "rename", newName);
    hideEditInstanceNameModal();
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
        if (response.status === 403) {
            window.location.href = "/denied";
            return;
        }
        if (!response.ok) throw new Error("Failed to fetch instances");
        const instances = await response.json();
        const container = document.getElementById("instances");
        container.innerHTML = "";

        instances.forEach((instance) => {
            const instanceId = instance.InstanceId;
            const state = instance.State;
            const instanceName = instance.Tags.find((tag) => tag.Key === "Name")?.Value || "Unnamed";
            const operatingSystem = instance.Tags.find((tag) => tag.Key === "operatingSystem")?.Value || "N/A";
            const publicIp = instance.PublicIpAddress || "N/A";
            const privateIp = instance.PrivateIpAddress || "N/A";
            const launchTime = new Date(instance.LaunchTime).toLocaleString();
            const owner =
                instance.Tags.find((tag) => tag.Key === "username")?.Value || "N/A";

            let actionButtons = "";
            if (state === "running") {
                actionButtons = `<button id="stop-${instanceId}" onclick="handleAction('${instanceId}', 'stop')" class="bg-red-600 text-gray-100 py-2 px-3 rounded hover:bg-red-700 mt-4">
                <span>Stop</span>
                    <svg class="ml-2 w-5 h-5 text-white animate-spin hidden" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                </button>`;
            } else if (state === "stopped") {
                actionButtons = `<button id="start-${instanceId}" onclick="handleAction('${instanceId}', 'start')" class="bg-green-600 text-gray-100 py-2 px-3 rounded hover:bg-green-700 mt-4">
                <span>Start</span>
                    <svg class="ml-2 w-5 h-5 text-white animate-spin hidden" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                </button>`;
            }

            if (state !== "shutting-down") {
                actionButtons += `
                    <button onclick="showTerminateModal('${instanceId}')" class="bg-red-800 text-gray-100 py-2 px-4 rounded hover:bg-red-900 mt-4">Delete Instance</button>
                `;
            }

            if (instanceName === "WINDOWS-INSTANCE") {
                actionButtons += `
                    <button onclick="showPasswordModal('${instanceId}')" class="bg-white text-black py-2 px-4 rounded hover:bg-gray-200 mt-4">Show Password</button>
                `;
            }

            const instanceHtml = `
                <div class="bg-gray-800 shadow-lg rounded-lg p-6">
                    <h2 class="text-xl font-semibold mb-2">Instance ID: ${instanceId}
                        <button class="ml-2" onclick="copyToClipboard('${instanceId}')">
                            <img src="./assets/copy.svg" alt="Copy Icon" width="16" height="16" />
                        </button>
                    </h2>
                    <p class="text-gray-300 mb-2">State: <span class="font-semibold ${
                        state === "running" ? "text-green-400" : "text-red-400"
                    }">${state}</span></p>
                    <p class="text-gray-300 mb-2">Name: ${instanceName}
                        <button class="ml-2" onclick="showEditInstanceNameModal('${instanceId}', '${instanceName}')">
                            <img src="./assets/edit.svg" alt="Edit Icon" width="16" height="16" />
                        </button>
                    </p>
                    <p class="text-gray-300 mb-2">
                        Username: ${
                            operatingSystem === "linux"
                                ? "ubuntu"
                                : operatingSystem === "windows"
                                ? "Administrator"
                                : ""
                        }
                    </p>
                    <p class="text-gray-300 mb-2">Public IP: ${publicIp}
                        <button class="ml-2" onclick="copyToClipboard('${publicIp}')">
                            <img src="./assets/copy.svg" alt="Copy Icon" width="16" height="16" />
                        </button>
                    </p>
                    <p class="text-gray-300 mb-2">Private IP: ${privateIp}
                        <button class="ml-2" onclick="copyToClipboard('${privateIp}')">
                            <img src="./assets/copy.svg" alt="Copy Icon" width="16" height="16" />
                        </button>
                    </p>
                    <p class="text-gray-300 mb-2">Launch Time: ${launchTime}</p>
                    <p class="text-gray-300 mb-2">Instance owner: ${owner}</p>
                    <div class="flex space-x-4 mt-4">
                        ${actionButtons}
                    </div>
                </div>
            `;
            container.innerHTML += instanceHtml;
        });
    } catch (error) {
        console.error("Error fetching instances:", error);
    }
}

function copyToClipboard(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    new Noty({
        text: "Copied to clipboard!",
        type: "success",
        layout: "bottomRight",
        timeout: 3000,
        theme: "metroui",
        progressBar: true,
    }).show();
}



async function handleAction(instanceId, action, newName = null) {
    let buttonId;
    if (action === "stop") {
        buttonId = `stop-${instanceId}`;
    } else if (action === "start") {
        buttonId = `start-${instanceId}`;
    } else if (action === "rename") {
        buttonId = `rename-${instanceId}`;
    } else {
        console.error("Unsupported action:", action);
        return;
    }

    setButtonLoading(buttonId, true);

    try {
        const bodyData = { instanceId, action };

        if (action === "rename" && newName) {
            bodyData.newName = newName;
        }

        const response = await fetch("/api/ec2/manage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bodyData),
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
        console.error("Error managing instance:", error);
        new Noty({
            text: "Error managing instance. Please try again later.",
            type: "error",
            layout: "bottomRight",
            timeout: 5000,
            theme: "metroui",
            progressBar: true,
        }).show();
    } finally {
        setButtonLoading(buttonId, false);
    }
}



function showTerminateModal(instanceId) {
    currentInstanceId = instanceId;
    document.getElementById("terminateModal").style.display = "flex";
    document.getElementById("modalInstanceId").focus();
}

function hideTerminateModal() {
    document.getElementById("modalInstanceId").value = "";
    document.getElementById("terminateModal").style.display = "none";
}

let currentInstanceId = null;

function showEditInstanceNameModal(instanceId, currentName) {
    currentInstanceId = instanceId;
    document.getElementById("newInstanceName").value = currentName;
    document.getElementById("editInstanceNameModal").style.display = "flex";
    document.getElementById("newInstanceName").focus();
}

function hideEditInstanceNameModal() {
    document.getElementById("editInstanceNameModal").style.display = "none";
    document.getElementById("newInstanceName").value = "";
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
