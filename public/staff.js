
const staffForm = document.getElementById("staffForm");
const staffTable = document.getElementById("staffTable");
const message = document.getElementById("message");

function showMessage(text, isError = false) {
    message.textContent = text;
    message.style.color = isError ? "red" : "green";
}

// Load staff members
async function loadStaff() {
    try {
        const response = await fetch("/api/staff");
        const staff = await response.json();

        if (!response.ok) {
            throw new Error(staff.error || "Unable to load staff.");
        }

        staffTable.innerHTML = "";

        if (staff.length === 0) {
            staffTable.innerHTML =
                '<tr><td colspan="5">No staff members found.</td></tr>';
            return;
        }

        staff.forEach(person => {
            const row = document.createElement("tr");

            const values = [
                person.full_name,
                person.username,
                person.role,
                person.status
            ];

            values.forEach(value => {
                const cell = document.createElement("td");
                cell.textContent = value ?? "";
                row.appendChild(cell);
            });

            const actionCell = document.createElement("td");
            const button = document.createElement("button");

            button.textContent =
                person.status === "active" ? "Deactivate" : "Activate";

            button.addEventListener("click", () => {
                const newStatus =
                    person.status === "active" ? "inactive" : "active";

                updateStaffStatus(person.user_id, newStatus);
            });

            actionCell.appendChild(button);
            row.appendChild(actionCell);
            staffTable.appendChild(row);
        });

    } catch (error) {
        showMessage(error.message, true);
    }
}

// Create a staff account
staffForm.addEventListener("submit", async event => {
    event.preventDefault();

    const staffData = {
        full_name: document.getElementById("full_name").value.trim(),
        username: document.getElementById("username").value.trim(),
        role: document.getElementById("role").value,
        password: document.getElementById("password").value
    };

    try {
        const response = await fetch("/api/staff", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(staffData)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || "Unable to create staff account.");
        }

        showMessage("Staff account created successfully!");
        staffForm.reset();
        await loadStaff();

    } catch (error) {
        showMessage(error.message, true);
    }
});

// Activate or deactivate a staff account
async function updateStaffStatus(id, status) {
    try {
        const response = await fetch(`/api/staff/${id}`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ status })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || "Unable to update staff status.");
        }

        showMessage("Staff status updated successfully!");
        await loadStaff();

    } catch (error) {
        showMessage(error.message, true);
    }
}

// Load staff when the page opens
loadStaff();
