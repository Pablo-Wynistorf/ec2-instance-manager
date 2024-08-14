// JavaScript for mobile menu toggle
document.getElementById("menuToggle").addEventListener("click", function () {
  document.getElementById("mobileMenu").classList.remove("translate-x-full");
  document.getElementById("mobileMenu").classList.add("translate-x-0");
  document.body.classList.add("overflow-hidden"); // Prevent scrolling while menu is open
});

document
  .getElementById("mobileMenuCloseButton")
  .addEventListener("click", function () {
    document.getElementById("mobileMenu").classList.remove("translate-x-0");
    document.getElementById("mobileMenu").classList.add("translate-x-full");
    document.body.classList.remove("overflow-hidden"); // Allow scrolling again
  });

document
  .getElementById("mobileLogoutButton")
  .addEventListener("click", function () {
    document.getElementById("logoutButton").click(); // Trigger logout button
  });

document
  .getElementById("mobileLaunchLinuxButton")
  .addEventListener("click", function () {
    document.getElementById("launchLinuxButton").click(); // Trigger Launch Linux button
  });

document
  .getElementById("mobileLaunchWindowsButton")
  .addEventListener("click", function () {
    document.getElementById("launchWindowsButton").click(); // Trigger Launch Windows button
  });

document
  .getElementById("mobileDownloadSshKeyButton")
  .addEventListener("click", function () {
    document.getElementById("downloadSshKeyButton").click(); // Trigger Download SSH Key button
  });

// Close mobile menu if clicking outside
document.addEventListener("click", function (event) {
  const menu = document.getElementById("mobileMenu");
  const menuToggle = document.getElementById("menuToggle");
  if (
    menu.classList.contains("translate-x-0") &&
    !menu.contains(event.target) &&
    !menuToggle.contains(event.target)
  ) {
    menu.classList.remove("translate-x-0");
    menu.classList.add("translate-x-full");
    document.body.classList.remove("overflow-hidden"); // Allow scrolling again
  }
});

// JavaScript for modals
function showModal(modalId) {
  document.getElementById(modalId).style.display = "flex";
  document.body.classList.add("overflow-hidden"); // Prevent scrolling while modal is open
}

function hideModal(modalId) {
  document.getElementById(modalId).style.display = "none";
  document.body.classList.remove("overflow-hidden"); // Allow scrolling again
}


// Close Terminate Modal
document
  .getElementById("cancelTerminateButton")
  .addEventListener("click", function () {
    hideModal("terminateModal");
  });

document
  .getElementById("confirmTerminateButton")
  .addEventListener("click", function () {
    // Confirm termination logic
    hideModal("terminateModal");
  });

// Open Password Modal example
document
  .getElementById("someOtherElement")
  .addEventListener("click", function () {
    showModal("passwordModal");
  });

// Close Password Modal
document
  .getElementById("closePasswordModalButton")
  .addEventListener("click", function () {
    hideModal("passwordModal");
  });

// Copy password to clipboard
document
  .getElementById("copyPasswordButton")
  .addEventListener("click", function () {
    const passwordInput = document.getElementById("passwordInput");
    passwordInput.select();
    document.execCommand("copy");
    new Noty({
      text: "Password copied to clipboard",
      type: "success",
      layout: "topRight",
    }).show();
  });

// Close modals if clicking outside
document.addEventListener("click", function (event) {
  const terminateModal = document.getElementById("terminateModal");
  const passwordModal = document.getElementById("passwordModal");
  if (
    (terminateModal.style.display === "flex" &&
      !terminateModal.contains(event.target)) ||
    (passwordModal.style.display === "flex" &&
      !passwordModal.contains(event.target))
  ) {
    hideModal("terminateModal");
    hideModal("passwordModal");
  }
});
