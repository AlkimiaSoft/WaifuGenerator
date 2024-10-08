
function generateImage() {

  const imageAlert = document.getElementById('imageAlert');

  imageAlert.style.display = 'block';

  const age = document.querySelector('input[name="age"]:checked')?.value ?? '';
  const bodyShape = document.querySelector('input[name="bodyShape"]:checked')?.value ?? '';
  const breastSize = document.querySelector('input[name="breastSize"]:checked')?.value ?? '';
  const expression = document.querySelector('input[name="expression"]:checked')?.value ?? '';
  const hairLength = document.querySelector('input[name="hairLength"]:checked')?.value ?? '';
  const hairType = document.querySelector('input[name="hairType"]:checked')?.value ?? '';
  const hairColor = document.getElementById('hairColor')?.value ?? '';
  const eyeColor = document.getElementById('eyeColor')?.value ?? '';
  const waifuName = document.getElementById('randomName')?.value ?? '';
  const fullClothes = document.querySelector('input[name="clothes"]:checked')?.value ?? '';
  const upperBodyClothes = document.querySelector('input[name="upperBody"]:checked')?.value ?? '';
  const lowerBodyClothes = document.querySelector('input[name="lowerBody"]:checked')?.value ?? '';
  const onePieceClothesColor = document.getElementById('onePieceClothesColor')?.value ?? '';
  const upperClothesColor = document.getElementById('upperClothesColor')?.value ?? '';
  const lowerClothesColor = document.getElementById('lowerClothesColor')?.value ?? '';
  

  const requestBody = {
    age: age,
    bodyShape: bodyShape,
    breastSize: breastSize,
    expression: expression,
    hairLength: hairLength,
    hairType: hairType,
    hairColor: hairColor,
    eyeColor: eyeColor,
    fullClothes: fullClothes,
    upperBodyClothes: upperBodyClothes,
    lowerBodyClothes: lowerBodyClothes,
    onePieceClothesColor: onePieceClothesColor,
    upperClothesColor: upperClothesColor,
    lowerClothesColor: lowerClothesColor,
    waifuName: waifuName
  };

  fetch('/generateImage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  })
    .then(response => {
      if (response.status === 403) {
        return response.json().then(data => {
          imageAlert.style.display = 'none';
          // Show notification with the response message
          showAlert(data.message, 'danger'); // Show a Bootstrap alert with the message
        });
      } else {
        return response.text();
      }
    })
    .then(imageTagContent => {
      if (imageTagContent) {
        // Create a new image element
        const img = document.createElement('img');

        // Set the source of the image to the image tag content
        img.src = img.src = 'data:image/jpeg;base64,' + imageTagContent;

        // Select the image container div
        const imageContainer = document.getElementById('imageContainer')

        // Append the image to the container
        imageContainer.appendChild(img);

        imageAlert.style.display = 'none';
      } else {
        console.log('Failed to fetch image tag content.');
      }
    })
    .catch(error => {
      console.error('There was a problem with the fetch operation:', error);
    });
}

function showAlert(message, type) {
  const alertPlaceholder = document.getElementById('alertPlaceHolder');
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
        <div class="alert alert-${type} alert-dismissible fade show" role="alert">
          ${message}
          <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        </div>
  `;
  alertPlaceholder.append(wrapper);

  // Automatically remove the alert after a few seconds (optional)
  setTimeout(() => {
    wrapper.remove();
  }, 3000); // Remove the alert after 3 seconds
}
